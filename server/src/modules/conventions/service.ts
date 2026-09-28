import { z } from 'zod';
import {
  ConventionExtractionResult,
  type ConventionCandidate,
  type Provider,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
import { resolveFeatureModel } from '../settings/feature-models.js';
import { SkillsService } from '../skills/service.js';
import { RepoRepository } from '../repos/repository.js';
import { ConventionsRepository, type ConventionRow } from './repository.js';
import { encodeEvidencePath, toConventionDto } from './helpers.js';

/** Config files worth sampling verbatim if present (repo root only). */
const CONFIG_FILE_CANDIDATES = [
  '.eslintrc',
  '.eslintrc.js',
  '.eslintrc.cjs',
  '.eslintrc.json',
  '.eslintrc.yml',
  '.eslintrc.yaml',
  'tsconfig.json',
  '.prettierrc',
  '.prettierrc.js',
  '.prettierrc.cjs',
  '.prettierrc.json',
  '.prettierrc.yml',
  '.prettierrc.yaml',
];

/** How many top-ranked source files (beyond config files) to sample. */
const CODE_SAMPLE_COUNT = 12;
/** Cap per-file content sent to the LLM — keeps prompt bounded. */
const MAX_FILE_CHARS = 4000;

export interface ConventionSample {
  path: string;
  content: string;
}

export interface CreateSkillFromConventionsInput {
  name?: string;
  description: string;
  candidateIds: string[];
  /** Editable in the create-skill modal before saving (rubric #41 — the
   *  future skill body/metadata must be editable, not just name/description).
   *  Falls back to the auto-concatenated rule list when omitted. */
  body?: string;
}

export class ConventionsService {
  private repo: ConventionsRepository;
  private reposRepo: RepoRepository;

  constructor(private container: Container) {
    this.repo = new ConventionsRepository(container.db);
    this.reposRepo = new RepoRepository(container.db);
  }

  async list(workspaceId: string, repoId: string): Promise<ConventionCandidate[]> {
    const rows = await this.repo.listByRepo(workspaceId, repoId);
    return rows.map(toConventionDto);
  }

  /**
   * Step (a) — pure I/O sample selection, no LLM call: config files that
   * exist at the repo root + the top-N ranked source files from repo-intel,
   * each read from the local clone.
   */
  private async collectSamples(workspaceId: string, repoId: string): Promise<ConventionSample[]> {
    const repoRow = await this.reposRepo.getById(workspaceId, repoId);
    if (!repoRow) throw new NotFoundError('Repo not found');
    const repoRef = { owner: repoRow.owner, name: repoRow.name };

    const samples: ConventionSample[] = [];
    const seen = new Set<string>();

    const tryRead = async (path: string) => {
      if (seen.has(path)) return;
      try {
        const content = await this.container.git.readFile(repoRef, path);
        seen.add(path);
        samples.push({ path, content: content.slice(0, MAX_FILE_CHARS) });
      } catch {
        // file doesn't exist in this repo — skip, per plan (§1a).
      }
    };

    for (const file of CONFIG_FILE_CANDIDATES) await tryRead(file);

    const codePaths = await this.container.repoIntel.getConventionSamples(repoId, CODE_SAMPLE_COUNT);
    for (const path of codePaths) await tryRead(path);

    return samples;
  }

  /** Step (b) — LLM call: send samples, get back Zod-validated candidates. */
  private async extractCandidates(
    workspaceId: string,
    samples: ConventionSample[],
  ): Promise<z.infer<typeof ConventionExtractionResult>['candidates']> {
    if (samples.length === 0) return [];

    const { provider, model } = await resolveFeatureModel(this.container, workspaceId, 'conventions');
    const llm = await this.container.llm(provider as Provider);

    const samplesText = samples
      .map((s) => `--- ${s.path} ---\n${s.content}`)
      .join('\n\n');

    const result = await llm.completeStructured({
      model,
      schema: ConventionExtractionResult,
      schemaName: 'ConventionExtraction',
      messages: [
        {
          role: 'system',
          content:
            'You are a senior engineer inferring the coding conventions actually followed by ' +
            'a repository, from a sample of its config files and top-ranked source files. ' +
            'Return concrete, checkable rules (naming, formatting, structural, testing, error ' +
            'handling, etc.) each grounded in a specific file/line. Do not invent rules the ' +
            'samples do not support. Confidence is your certainty this rule is actually ' +
            'enforced/followed across the codebase, 0-1.',
        },
        {
          role: 'user',
          content:
            `Repository samples:\n\n${samplesText}\n\n` +
            'Extract a list of coding-convention candidates as {category, rule, evidence: ' +
            '{file, line}, confidence}.',
        },
      ],
      maxRetries: 2,
    });

    return result.data.candidates;
  }

  /** #38-#40 — POST /repos/:id/conventions/extract full pipeline. */
  async extract(workspaceId: string, repoId: string): Promise<ConventionCandidate[]> {
    const samples = await this.collectSamples(workspaceId, repoId);
    const candidates = await this.extractCandidates(workspaceId, samples);

    const rows = await this.repo.insertMany(
      candidates.map((c) => ({
        workspaceId,
        repoId,
        rule: c.rule,
        category: c.category,
        evidencePath: encodeEvidencePath(c.evidence.file, c.evidence.line ?? undefined),
        confidence: c.confidence,
      })),
    );
    return rows.map(toConventionDto);
  }

  /** #47-#49 — PATCH /conventions/:id. */
  async patch(
    workspaceId: string,
    id: string,
    action: 'accept' | 'reject' | 'edit',
    edit?: { rule?: string; category?: string; evidence_path?: string; evidence_snippet?: string },
  ): Promise<ConventionCandidate> {
    let row: ConventionRow | undefined;
    if (action === 'accept') row = await this.repo.setAccepted(workspaceId, id);
    else if (action === 'reject') row = await this.repo.setRejected(workspaceId, id);
    else {
      row = await this.repo.update(workspaceId, id, {
        rule: edit?.rule,
        category: edit?.category,
        evidencePath: edit?.evidence_path,
        evidenceSnippet: edit?.evidence_snippet,
      });
    }
    if (!row) throw new NotFoundError('Convention candidate not found');
    return toConventionDto(row);
  }

  /** #41/#42/#50/#51 — POST /repos/:id/conventions/create-skill. */
  async createSkill(
    workspaceId: string,
    repoId: string,
    input: CreateSkillFromConventionsInput,
  ) {
    if (input.candidateIds.length === 0) {
      throw new ValidationError('candidate_ids must be non-empty');
    }
    const rows = await this.repo.getByIds(workspaceId, input.candidateIds);
    const usable = rows.filter((r) => r.repoId === repoId && r.rejected === false);
    if (usable.length === 0) {
      throw new ValidationError('No usable (non-rejected, same-repo) candidates given');
    }

    const body = input.body?.trim() || usable.map((r) => `- ${r.rule}`).join('\n');

    const skillsService = new SkillsService(this.container);
    // Default name is the fixed `repo-conventions` per rubric #42; the modal's
    // Name field can override it.
    const skill = await skillsService.create(workspaceId, {
      name: input.name?.trim() || 'repo-conventions',
      description: input.description,
      type: 'convention',
      body,
      source: 'manual',
      evidence_files: usable
        .map((r) => r.evidencePath)
        .filter((p): p is string => !!p),
    });

    // Open call from the plan: default to unlinked — no agent context to guess
    // from at the module level; user links it from Skills Lab / Agent editor.
    return skill;
  }
}
