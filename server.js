require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

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

app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password || username.length < 3 || username.length > 20 || !/^[a-zA-Z0-9_]+$/.test(username) || password.length < 8) {
    return res.status(400).json({ error: 'ユーザー名は3〜20文字の半角英数字とアンダースコア、パスワードは8文字以上である必要があります。' });
  }

  try {
    const hash = bcrypt.hashSync(password, 10);
    const { error } = await db.from('users').insert([{ username, password: hash }]);
    
    if (error) {
      if (error.code === '23505') {
        return res.status(400).json({ error: 'そのユーザー名はすでに使われています。' });
      }
      throw error;
    }
    
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'サーバーエラーが発生しました。' });
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'ユーザー名とパスワードを入力してください。' });
  }

  try {
    const { data: user, error } = await db.from('users').select('*').eq('username', username).single();

    if (!error && user && bcrypt.compareSync(password, user.password)) {
      req.session.userId = user.id;
      req.session.username = user.username;
      res.json({ success: true, username: user.username });
    } else {
      res.status(401).json({ error: 'ユーザー名またはパスワードが間違っています。' });
    }
  } catch (err) {
    console.error(err);
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

app.get('/api/texts', requireAuth, async (req, res) => {
  try {
    const { data: texts, error } = await db
      .from('texts')
      .select('*')
      .eq('user_id', req.session.userId)
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) throw error;
    res.json(texts);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'データの取得に失敗しました。' });
  }
});

app.post('/api/texts', requireAuth, async (req, res) => {
  const { content } = req.body;
  if (!content || content.length > 10000) {
    return res.status(400).json({ error: '無効なテキストです。' });
  }

  try {
    const { count, error: countError } = await db
      .from('texts')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', req.session.userId);

    if (countError) throw countError;
    if (count >= 20) {
      return res.status(400).json({ error: '保存上限（20件）に達しています。不要なデータを削除してから保存してください。' });
    }

    const { data: latest, error: latestError } = await db
      .from('texts')
      .select('content')
      .eq('user_id', req.session.userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!latestError && latest && latest.content === content) {
      return res.status(400).json({ error: 'すでに最新の状態で保存されています。' });
    }

    const { data: newText, error: insertError } = await db
      .from('texts')
      .insert([{ user_id: req.session.userId, content }])
      .select()
      .single();

    if (insertError) throw insertError;
    res.json(newText);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '保存に失敗しました。' });
  }
});

app.delete('/api/texts/:id', requireAuth, async (req, res) => {
  const textId = req.params.id;
  try {
    const { error } = await db
      .from('texts')
      .delete()
      .eq('id', textId)
      .eq('user_id', req.session.userId);

    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(404).json({ error: '削除に失敗したか、権限がありません。' });
  }
});

app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
