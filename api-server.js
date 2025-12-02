// api-server.js - Express API Server untuk FocusMode
import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import Database from './database.js';

const app = express();
const PORT = process.env.API_PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'focusmode-secret-key-2024';

// Di bagian awal api-server.js, tambahkan:
process.on('uncaughtException', error => {
  console.error('🔥 Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('🔥 Unhandled Rejection at:', promise, 'reason:', reason);
});

// Di route health check, tambahkan database status:
app.get('/api/health', async (req, res) => {
  try {
    // Test database connection
    await Database.query('SELECT 1');

    res.json({
      status: 'OK',
      service: 'FocusMode API',
      database: 'Connected',
      timestamp: new Date().toISOString(),
      port: 3307,
    });
  } catch (error) {
    res.status(500).json({
      status: 'ERROR',
      service: 'FocusMode API',
      database: 'Disconnected',
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// Middleware
app.use(cors());
app.use(express.json());

// Authentication middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid token' });
    }
    req.user = user;
    next();
  });
};

// Routes

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    service: 'FocusMode API',
    timestamp: new Date().toISOString(),
  });
});

// Authentication routes
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    if (password.length < 6) {
      return res
        .status(400)
        .json({ error: 'Password must be at least 6 characters' });
    }

    // Check if user already exists
    const existingUser = await Database.getUserByEmail(email);
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    const avatar = name.charAt(0).toUpperCase();

    // Create user
    const userId = await Database.createUser({
      name,
      email,
      password: hashedPassword,
      avatar,
    });

    // Generate JWT token
    const token = jwt.sign({ id: userId, email, name, avatar }, JWT_SECRET, {
      expiresIn: '7d',
    });

    res.status(201).json({
      message: 'User created successfully',
      user: {
        id: userId,
        name,
        email,
        avatar,
      },
      token,
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Get user from database
    const user = await Database.getUserByEmail(email);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Check password
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Update last login
    await Database.query('UPDATE users SET last_login = NOW() WHERE id = ?', [
      user.id,
    ]);

    // Generate JWT token
    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        name: user.name,
        avatar: user.avatar,
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      message: 'Login successful',
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        avatar: user.avatar,
        settings: {
          push_enabled: user.push_enabled,
          daily_reminders: user.daily_reminders,
          session_reminders: user.session_reminders,
          achievement_alerts: user.achievement_alerts,
        },
      },
      token,
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Protected routes
app.get('/api/user/dashboard', authenticateToken, async (req, res) => {
  try {
    const dashboardData = await Database.getDashboardData(req.user.id);
    const todayStats = await Database.getTodayStats(req.user.id);

    res.json({
      user: req.user,
      dashboard: dashboardData,
      todayStats,
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Study Sessions routes
app.get('/api/sessions', authenticateToken, async (req, res) => {
  try {
    const sessions = await Database.getSessionsByUserId(req.user.id);
    res.json(sessions);
  } catch (error) {
    console.error('Get sessions error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/sessions', authenticateToken, async (req, res) => {
  try {
    const { title, description, subject, duration, status } = req.body;

    console.log('📝 Creating session for user:', req.user.id);
    console.log('📝 Session data:', {
      title,
      description,
      subject,
      duration,
      status,
    });

    const sessionId = await Database.createSession({
      user_id: req.user.id,
      title,
      description,
      subject,
      duration,
      status: status || 'planned',
    });

    console.log('✅ Session created with ID:', sessionId);

    // Fetch the created session to return full data
    const sessions = await Database.getSessionsByUserId(req.user.id);
    const createdSession = sessions.find(s => s.id === sessionId);

    res.status(201).json({
      message: 'Session created successfully',
      id: sessionId,
      session: createdSession,
    });
  } catch (error) {
    console.error('Create session error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/sessions/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, subject, duration, status } = req.body;

    // Verify session belongs to user
    const sessions = await Database.getSessionsByUserId(req.user.id);
    const session = sessions.find(s => s.id === parseInt(id));
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    await Database.updateSession(
      id,
      {
        title,
        description,
        subject,
        duration,
        status,
      },
      req.user.id
    );

    console.log('✅ Session updated in database:', id);
    res.json({ message: 'Session updated successfully' });
  } catch (error) {
    console.error('Update session error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/sessions/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Verify session belongs to user
    const sessions = await Database.getSessionsByUserId(req.user.id);
    const session = sessions.find(s => s.id === parseInt(id));
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    await Database.deleteSession(id, req.user.id);
    console.log('✅ Session deleted from database:', id);
    res.json({ message: 'Session deleted successfully' });
  } catch (error) {
    console.error('Delete session error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/sessions/:id/start', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Verify session belongs to user
    const sessions = await Database.getSessionsByUserId(req.user.id);
    const session = sessions.find(s => s.id === parseInt(id));
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    await Database.startSession(id, req.user.id);
    console.log('✅ Session started in database:', id);
    res.json({ message: 'Session started successfully' });
  } catch (error) {
    console.error('Start session error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/sessions/:id/complete', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Verify session belongs to user
    const sessions = await Database.getSessionsByUserId(req.user.id);
    const session = sessions.find(s => s.id === parseInt(id));
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    await Database.completeSession(id, req.user.id);

    // Update study stats
    const sessionDuration = session.duration || 0;
    await Database.updateStudyStats(req.user.id, sessionDuration, true);

    console.log(
      '✅ Session completed in database:',
      id,
      'Duration:',
      sessionDuration
    );
    res.json({ message: 'Session completed successfully' });
  } catch (error) {
    console.error('Complete session error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Notes routes
app.get('/api/notes', authenticateToken, async (req, res) => {
  try {
    const { category = 'all' } = req.query;
    const notes = await Database.getNotesByUserId(req.user.id, category);
    res.json(notes);
  } catch (error) {
    console.error('Get notes error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/notes', authenticateToken, async (req, res) => {
  try {
    const { title, content, category } = req.body;

    console.log('📝 Creating note for user:', req.user.id);
    console.log('📝 Note data:', { title, content, category });

    const noteId = await Database.createNote({
      user_id: req.user.id,
      title,
      content,
      category: category || 'study',
    });

    console.log('✅ Note created with ID:', noteId);

    res.status(201).json({
      message: 'Note created successfully',
      id: noteId,
    });
  } catch (error) {
    console.error('Create note error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/notes/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content, category } = req.body;

    // Verify note belongs to user
    const notes = await Database.getNotesByUserId(req.user.id);
    const note = notes.find(n => n.id === parseInt(id));
    if (!note) {
      return res.status(404).json({ error: 'Note not found' });
    }

    await Database.updateNote(
      id,
      {
        title,
        content,
        category,
      },
      req.user.id
    );

    console.log('✅ Note updated in database:', id);
    res.json({ message: 'Note updated successfully' });
  } catch (error) {
    console.error('Update note error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/notes/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Verify note belongs to user
    const notes = await Database.getNotesByUserId(req.user.id);
    const note = notes.find(n => n.id === parseInt(id));
    if (!note) {
      return res.status(404).json({ error: 'Note not found' });
    }

    await Database.deleteNote(id, req.user.id);
    console.log('✅ Note deleted from database:', id);
    res.json({ message: 'Note deleted successfully' });
  } catch (error) {
    console.error('Delete note error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Books routes
app.get('/api/books', authenticateToken, async (req, res) => {
  try {
    const books = await Database.getBooksByUserId(req.user.id);
    res.json(books);
  } catch (error) {
    console.error('Get books error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/books', authenticateToken, async (req, res) => {
  try {
    const { title, author, description, category, is_complete } = req.body;

    console.log('📚 Creating book for user:', req.user.id);
    console.log('📚 Book data:', { title, author, description, category });

    const bookId = await Database.createBook({
      user_id: req.user.id,
      title,
      author,
      description,
      category: category || 'academic',
      is_complete: is_complete || false,
    });

    console.log('✅ Book created with ID:', bookId);

    res.status(201).json({
      message: 'Book created successfully',
      id: bookId,
    });
  } catch (error) {
    console.error('Create book error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/books/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, author, description, category, is_complete } = req.body;

    // Verify book belongs to user
    const books = await Database.getBooksByUserId(req.user.id);
    const book = books.find(b => b.id === parseInt(id));
    if (!book) {
      return res.status(404).json({ error: 'Book not found' });
    }

    await Database.updateBook(
      id,
      {
        title,
        author,
        description,
        category,
        is_complete,
      },
      req.user.id
    );

    console.log('✅ Book updated in database:', id);
    res.json({ message: 'Book updated successfully' });
  } catch (error) {
    console.error('Update book error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/books/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Verify book belongs to user
    const books = await Database.getBooksByUserId(req.user.id);
    const book = books.find(b => b.id === parseInt(id));
    if (!book) {
      return res.status(404).json({ error: 'Book not found' });
    }

    await Database.deleteBook(id, req.user.id);
    console.log('✅ Book deleted from database:', id);
    res.json({ message: 'Book deleted successfully' });
  } catch (error) {
    console.error('Delete book error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/books/:id/toggle', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Verify book belongs to user
    const books = await Database.getBooksByUserId(req.user.id);
    const book = books.find(b => b.id === parseInt(id));
    if (!book) {
      return res.status(404).json({ error: 'Book not found' });
    }

    await Database.toggleBookStatus(id, req.user.id);
    console.log('✅ Book status toggled in database:', id);
    res.json({ message: 'Book status updated successfully' });
  } catch (error) {
    console.error('Toggle book error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Focus timers routes
app.post('/api/timers', authenticateToken, async (req, res) => {
  try {
    const { timer_type, duration, task_description } = req.body;

    const timerId = await Database.saveFocusTimer({
      user_id: req.user.id,
      timer_type,
      duration,
      task_description,
    });

    res.status(201).json({
      message: 'Timer saved successfully',
      id: timerId,
    });
  } catch (error) {
    console.error('Save timer error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/timers/:id/complete', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { duration } = req.body; // Duration in minutes

    await Database.completeFocusTimer(id);

    // Update study stats with the timer duration
    if (duration && duration > 0) {
      await Database.updateStudyStats(req.user.id, duration, true);
      console.log(
        '📊 Updated study stats for user:',
        req.user.id,
        'Duration:',
        duration
      );
    }

    res.json({ message: 'Timer completed successfully' });
  } catch (error) {
    console.error('Complete timer error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/timers', authenticateToken, async (req, res) => {
  try {
    const timers = await Database.getFocusTimersByUserId(req.user.id);
    res.json(timers);
  } catch (error) {
    console.error('Get timers error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Statistics routes
app.get('/api/stats/today', authenticateToken, async (req, res) => {
  try {
    const todayStats = await Database.getTodayStats(req.user.id);
    console.log('📊 Today stats for user:', req.user.id, todayStats);
    res.json(todayStats);
  } catch (error) {
    console.error('Get today stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/stats/weekly', authenticateToken, async (req, res) => {
  try {
    const weeklyReport = await Database.getWeeklyReport(req.user.id);
    console.log('📊 Weekly stats for user:', req.user.id, weeklyReport);
    res.json(weeklyReport);
  } catch (error) {
    console.error('Get weekly stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/stats/summary', authenticateToken, async (req, res) => {
  try {
    const dashboardData = await Database.getDashboardData(req.user.id);
    const todayStats = await Database.getTodayStats(req.user.id);
    const weeklyReport = await Database.getWeeklyReport(req.user.id);
    const currentStreak = await Database.getCurrentStreak(req.user.id);

    // Calculate weekly totals
    const weeklyTotalMinutes = weeklyReport.reduce(
      (sum, day) => sum + (day.total_minutes || 0),
      0
    );
    const weeklyTotalSessions = weeklyReport.reduce(
      (sum, day) => sum + (day.sessions_count || 0),
      0
    );

    res.json({
      user: {
        name: dashboardData?.name,
        email: dashboardData?.email,
      },
      overview: {
        completed_sessions: dashboardData?.completed_sessions || 0,
        total_notes: dashboardData?.total_notes || 0,
        total_books: dashboardData?.total_books || 0,
      },
      today: {
        total_minutes: parseInt(todayStats?.total_minutes) || 0,
        total_sessions: parseInt(todayStats?.total_sessions) || 0,
      },
      weekly: {
        total_minutes: weeklyTotalMinutes,
        total_sessions: weeklyTotalSessions,
        daily_breakdown: weeklyReport,
      },
      streak: currentStreak,
    });
  } catch (error) {
    console.error('Get stats summary error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/stats/streak', authenticateToken, async (req, res) => {
  try {
    const streak = await Database.getCurrentStreak(req.user.id);
    console.log('📊 Current streak for user:', req.user.id, streak);
    res.json({ streak_days: streak });
  } catch (error) {
    console.error('Get streak error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/stats/monthly', authenticateToken, async (req, res) => {
  try {
    const monthlyStats = await Database.getMonthlyStats(req.user.id);
    console.log('📊 Monthly stats for user:', req.user.id, monthlyStats);
    res.json(monthlyStats);
  } catch (error) {
    console.error('Get monthly stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/stats/history', authenticateToken, async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const studyStats = await Database.getStudyStats(req.user.id, days);
    console.log('📊 Study history for user:', req.user.id, 'days:', days);
    res.json(studyStats);
  } catch (error) {
    console.error('Get study history error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Settings routes
app.put('/api/settings', authenticateToken, async (req, res) => {
  try {
    const {
      push_enabled,
      daily_reminders,
      session_reminders,
      achievement_alerts,
    } = req.body;

    await Database.query(
      `
      UPDATE user_settings 
      SET push_enabled = ?, daily_reminders = ?, session_reminders = ?, achievement_alerts = ?
      WHERE user_id = ?
    `,
      [
        push_enabled,
        daily_reminders,
        session_reminders,
        achievement_alerts,
        req.user.id,
      ]
    );

    res.json({ message: 'Settings updated successfully' });
  } catch (error) {
    console.error('Update settings error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Start server
async function startServer() {
  try {
    await Database.connect();

    app.listen(PORT, () => {
      console.log('🎯 FocusMode API Server');
      console.log(`📍 Running on http://localhost:${PORT}`);
      console.log(`📊 Connected to MySQL database: focusmode_db`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down API server gracefully...');
  await Database.disconnect();
  process.exit(0);
});

startServer();

export default app;
