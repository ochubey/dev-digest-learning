interface Db {
  exec(sql: string): unknown;
}

/** Look up a user row by login. */
export function findUserByLogin(db: Db, login: string) {
  return db.exec("SELECT * FROM users WHERE login = '" + login + "'");
}
