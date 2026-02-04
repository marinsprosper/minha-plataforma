import Database from "better-sqlite3";

export const db = new Database("data.sqlite");
db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    passwordHash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    fullName TEXT,
    taxNumber TEXT,
    depixAddress TEXT,
    commissionBps INTEGER,
    createdAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS deposits (
    id TEXT PRIMARY KEY,
    userId INTEGER NOT NULL,
    amountInCents INTEGER NOT NULL,
    commissionBps INTEGER NOT NULL,
    feeInCents INTEGER NOT NULL,
    netInCents INTEGER NOT NULL,
    platformDepixAddress TEXT NOT NULL,
    userDepixAddress TEXT NOT NULL,
    qrCopyPaste TEXT,
    qrImageUrl TEXT,
    status TEXT DEFAULT 'created',
    bankTxId TEXT,
    blockchainTxID TEXT,
    expiration TEXT,
    payerName TEXT,
    payerTaxNumber TEXT,
    payoutStatus TEXT DEFAULT 'not_sent',
    payoutTxId TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY (userId) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS withdrawals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER NOT NULL,
    amountDepix TEXT NOT NULL,
    pixDestination TEXT NOT NULL,
    userDepixAddress TEXT NOT NULL,
    platformDepixAddress TEXT NOT NULL,
    txid TEXT,
    receiptPath TEXT,
    status TEXT NOT NULL DEFAULT 'awaiting_transfer',
    adminNote TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY (userId) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_deposits_userId_createdAt ON deposits(userId, createdAt DESC);
  CREATE INDEX IF NOT EXISTS idx_withdrawals_userId_createdAt ON withdrawals(userId, createdAt DESC);

  INSERT OR IGNORE INTO settings (key, value) VALUES ('defaultCommissionBps', '250');
`);

export const stmt = {
  createUser: db.prepare(`
    INSERT INTO users (email, passwordHash, role, fullName, taxNumber, createdAt)
    VALUES (@email, @passwordHash, @role, @fullName, @taxNumber, @createdAt)
  `),
  getUserByEmail: db.prepare(`SELECT * FROM users WHERE email = ?`),
  getUserById: db.prepare(`SELECT * FROM users WHERE id = ?`),
  updateUserWallet: db.prepare(`UPDATE users SET depixAddress=@depixAddress WHERE id=@id`),
  updateUserCommission: db.prepare(`UPDATE users SET commissionBps=@commissionBps WHERE id=@id`),

  getSetting: db.prepare(`SELECT value FROM settings WHERE key = ?`),
  setSetting: db.prepare(`INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`),

  insertDeposit: db.prepare(`
    INSERT INTO deposits (
      id, userId, amountInCents, commissionBps, feeInCents, netInCents,
      platformDepixAddress, userDepixAddress,
      qrCopyPaste, qrImageUrl, status, payoutStatus,
      createdAt, updatedAt
    ) VALUES (
      @id, @userId, @amountInCents, @commissionBps, @feeInCents, @netInCents,
      @platformDepixAddress, @userDepixAddress,
      @qrCopyPaste, @qrImageUrl, @status, @payoutStatus,
      @createdAt, @updatedAt
    )
  `),
  listDepositsByUser: db.prepare(`SELECT * FROM deposits WHERE userId = ? ORDER BY createdAt DESC LIMIT 100`),
  getDeposit: db.prepare(`SELECT * FROM deposits WHERE id = ?`),
  updateDeposit: db.prepare(`
    UPDATE deposits SET
      status=@status,
      bankTxId=COALESCE(@bankTxId, bankTxId),
      blockchainTxID=COALESCE(@blockchainTxID, blockchainTxID),
      expiration=COALESCE(@expiration, expiration),
      payerName=COALESCE(@payerName, payerName),
      payerTaxNumber=COALESCE(@payerTaxNumber, payerTaxNumber),
      updatedAt=@updatedAt
    WHERE id=@id
  `),

  createWithdrawal: db.prepare(`
    INSERT INTO withdrawals (
      userId, amountDepix, pixDestination, userDepixAddress, platformDepixAddress,
      status, createdAt, updatedAt
    ) VALUES (
      @userId, @amountDepix, @pixDestination, @userDepixAddress, @platformDepixAddress,
      @status, @createdAt, @updatedAt
    )
  `),
  listWithdrawalsByUser: db.prepare(`SELECT * FROM withdrawals WHERE userId=? ORDER BY createdAt DESC LIMIT 100`),
  getWithdrawalById: db.prepare(`SELECT * FROM withdrawals WHERE id=?`),
  updateWithdrawalProof: db.prepare(`
    UPDATE withdrawals SET txid=@txid, receiptPath=@receiptPath, status=@status, updatedAt=@updatedAt
    WHERE id=@id
  `),
  adminListWithdrawals: db.prepare(`
    SELECT w.*, u.email as userEmail FROM withdrawals w
    JOIN users u ON u.id = w.userId
    ORDER BY w.createdAt DESC LIMIT 200
  `),
  adminUpdateWithdrawalStatus: db.prepare(`
    UPDATE withdrawals SET status=@status, adminNote=@adminNote, updatedAt=@updatedAt
    WHERE id=@id
  `),

  adminListUsers: db.prepare(`SELECT id,email,role,depixAddress,commissionBps,createdAt FROM users ORDER BY createdAt DESC LIMIT 500`)
};
