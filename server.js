const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bodyParser = require('body-parser');
const session = require('express-session');
const bcrypt = require('bcrypt');

const app = express();
const db = new sqlite3.Database('./db.sqlite');

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(session({
  secret: 'secret-key',
  resave: false,
  saveUninitialized: true,
}));

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Initialize database tables
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    title TEXT,
    completed INTEGER DEFAULT 0,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);
});

// Register endpoint
app.post('/api/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  const hashedPassword = bcrypt.hashSync(password, 10);
  const stmt = db.prepare('INSERT INTO users (username, password) VALUES (?, ?)');
  stmt.run(username, hashedPassword, function(err) {
    if (err) {
      return res.status(400).json({ error: 'Username already exists' });
    }
    res.json({ message: 'User registered successfully' });
  });
  stmt.finalize();
});

// Login endpoint
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  db.get('SELECT * FROM users WHERE username = ?', [username], (err, user) => {
    if (err || !user) {
      return res.status(400).json({ error: 'Invalid username or password' });
    }
    if (!bcrypt.compareSync(password, user.password)) {
      return res.status(400).json({ error: 'Invalid username or password' });
    }
    req.session.userId = user.id;
    res.json({ message: 'Login successful' });
  });
});

// Middleware to check authentication
function isAuthenticated(req, res, next) {
  if (req.session.userId) {
    next();
  } else {
    res.status(401).json({ error: 'Unauthorized' });
  }
}

// Get tasks for logged in user
app.get('/api/tasks', isAuthenticated, (req, res) => {
  db.all('SELECT * FROM tasks WHERE user_id = ?', [req.session.userId], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to fetch tasks' });
    }
    res.json(rows);
  });
});

// Add new task
app.post('/api/tasks', isAuthenticated, (req, res) => {
  const { title } = req.body;
  if (!title) {
    return res.status(400).json({ error: 'Task title required' });
  }
  const stmt = db.prepare('INSERT INTO tasks (user_id, title) VALUES (?, ?)');
  stmt.run(req.session.userId, title, function(err) {
    if (err) {
      return res.status(500).json({ error: 'Failed to add task' });
    }
    res.json({ id: this.lastID, title, completed: 0 });
  });
  stmt.finalize();
});

// Update task (mark complete/incomplete)
app.put('/api/tasks/:id', isAuthenticated, (req, res) => {
  const { id } = req.params;
  const { completed } = req.body;
  const stmt = db.prepare('UPDATE tasks SET completed = ? WHERE id = ? AND user_id = ?');
  stmt.run(completed ? 1 : 0, id, req.session.userId, function(err) {
    if (err || this.changes === 0) {
      return res.status(500).json({ error: 'Failed to update task' });
    }
    res.json({ message: 'Task updated' });
  });
  stmt.finalize();
});

// Delete task
app.delete('/api/tasks/:id', isAuthenticated, (req, res) => {
  const { id } = req.params;
  const stmt = db.prepare('DELETE FROM tasks WHERE id = ? AND user_id = ?');
  stmt.run(id, req.session.userId, function(err) {
    if (err || this.changes === 0) {
      return res.status(500).json({ error: 'Failed to delete task' });
    }
    res.json({ message: 'Task deleted' });
  });
  stmt.finalize();
});

// Serve login page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Serve dashboard page
app.get('/dashboard', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// Logout
app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ message: 'Logged out' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
