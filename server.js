require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1); // Render等のプロキシ環境でHTTPSセッションを有効にするために必要

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'moji-pick-secret-key-12345',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 24 * 7
  }
}));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many requests, please try again later.' }
});

const requireAuth = (req, res, next) => {
  if (req.session.userId) {
    next();
  } else {
    res.status(401).json({ error: 'Unauthorized' });
  }
};

app.post('/api/register', (req, res) => { // authLimiter を一時的に解除
  const { username, password } = req.body;
  if (!username || !password || username.length < 3 || username.length > 20 || !/^[a-zA-Z0-9_]+$/.test(username) || password.length < 8) {
    return res.status(400).json({ error: 'ユーザー名は3〜20文字の半角英数字とアンダースコア、パスワードは8文字以上である必要があります。' });
  }

  try {
    const hash = bcrypt.hashSync(password, 10);
    const stmt = db.prepare('INSERT INTO users (username, password) VALUES (?, ?)');
    stmt.run(username, hash);
    res.json({ success: true });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      res.status(400).json({ error: 'そのユーザー名はすでに使われています。' });
    } else {
      res.status(500).json({ error: 'サーバーエラーが発生しました。' });
    }
  }
});

app.post('/api/login', (req, res) => { // authLimiter を一時的に解除
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'ユーザー名とパスワードを入力してください。' });
  }

  const stmt = db.prepare('SELECT * FROM users WHERE username = ?');
  const user = stmt.get(username);

  if (user && bcrypt.compareSync(password, user.password)) {
    req.session.userId = user.id;
    req.session.username = user.username;
    res.json({ success: true, username: user.username });
  } else {
    res.status(401).json({ error: 'ユーザー名またはパスワードが間違っています。' });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) return res.status(500).json({ error: 'ログアウトに失敗しました。' });
    res.clearCookie('connect.sid');
    res.json({ success: true });
  });
});

app.get('/api/session', (req, res) => {
  if (req.session.userId) {
    res.json({ loggedIn: true, username: req.session.username });
  } else {
    res.json({ loggedIn: false });
  }
});

app.get('/api/texts', requireAuth, (req, res) => {
  const stmt = db.prepare('SELECT * FROM texts WHERE user_id = ? ORDER BY created_at DESC LIMIT 20');
  const texts = stmt.all(req.session.userId);
  res.json(texts);
});

app.post('/api/texts', requireAuth, (req, res) => {
  const { content } = req.body;
  if (!content || content.length > 10000) {
    return res.status(400).json({ error: '無効なテキストです。' });
  }

  const countStmt = db.prepare('SELECT COUNT(*) as count FROM texts WHERE user_id = ?');
  const { count } = countStmt.get(req.session.userId);

  if (count >= 20) {
    return res.status(400).json({ error: '保存上限（20件）に達しています。不要なデータを削除してから保存してください。' });
  }

  const checkDupStmt = db.prepare('SELECT content FROM texts WHERE user_id = ? ORDER BY created_at DESC LIMIT 1');
  const latest = checkDupStmt.get(req.session.userId);
  if (latest && latest.content === content) {
    return res.status(400).json({ error: 'すでに最新の状態で保存されています。' });
  }

  const insertStmt = db.prepare('INSERT INTO texts (user_id, content) VALUES (?, ?)');
  const result = insertStmt.run(req.session.userId, content);
  
  const newTextStmt = db.prepare('SELECT * FROM texts WHERE id = ?');
  const newText = newTextStmt.get(result.lastInsertRowid);
  
  res.json(newText);
});

app.delete('/api/texts/:id', requireAuth, (req, res) => {
  const textId = req.params.id;
  const stmt = db.prepare('DELETE FROM texts WHERE id = ? AND user_id = ?');
  const info = stmt.run(textId, req.session.userId);
  
  if (info.changes > 0) {
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'テキストが見つからないか、権限がありません。' });
  }
});

app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
