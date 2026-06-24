import express from 'express';
import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { createToken, hashPassword, readToken, verifyPassword } from './auth.js';
import { calculatePoints } from './scoring.js';
import { getState, loadStore, mutate, publicUser } from './store.js';

const PORT = process.env.PORT || 4000;
const TOKEN_SECRET = process.env.TOKEN_SECRET || 'quiz-room-dev-secret';
const TLS_CERT_FILE = process.env.TLS_CERT_FILE;
const TLS_KEY_FILE = process.env.TLS_KEY_FILE;
const TLS_CA_FILE = process.env.TLS_CA_FILE;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultOrigins = ['http://127.0.0.1:5173', 'http://localhost:5173'];
const allowedOrigins = (process.env.CLIENT_ORIGIN || defaultOrigins.join(','))
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const clientDistPath = path.join(__dirname, '..', 'dist');

await loadStore();

const app = express();
const tlsEnabled = Boolean(TLS_CERT_FILE && TLS_KEY_FILE);
const server = tlsEnabled
  ? https.createServer({
      cert: fs.readFileSync(TLS_CERT_FILE),
      key: fs.readFileSync(TLS_KEY_FILE),
      ...(TLS_CA_FILE ? { ca: fs.readFileSync(TLS_CA_FILE) } : {})
    }, app)
  : http.createServer(app);
const socketOptions = process.env.NODE_ENV === 'production' && !process.env.CLIENT_ORIGIN
  ? {}
  : { cors: { origin: allowedOrigins, methods: ['GET', 'POST', 'PUT'] } };
const io = new Server(server, socketOptions);

const questionTimers = new Map();

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  return next();
});

app.use(express.json({ limit: '8mb' }));

function id(prefix) {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
}

function roomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
}

function getUserByToken(token) {
  const payload = readToken(token, TOKEN_SECRET);
  if (!payload) return null;
  return getState().users.find((user) => user.id === payload.sub) || null;
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const user = getUserByToken(token);
  if (!user) return res.status(401).json({ error: 'Требуется авторизация' });
  req.user = user;
  next();
}

function requireOrganizer(req, res, next) {
  if (req.user.role !== 'organizer') {
    return res.status(403).json({ error: 'Доступ только для организаторов' });
  }
  next();
}

function publicQuiz(quiz, includeAnswers = false) {
  return {
    ...quiz,
    questions: quiz.questions.map((question) => ({
      ...question,
      options: question.options.map((option) => includeAnswers ? option : { id: option.id, text: option.text })
    }))
  };
}

function compactQuiz(quiz) {
  return {
    id: quiz.id,
    title: quiz.title,
    categories: quiz.categories,
    questionCount: quiz.questions.length,
    timeLimitSeconds: quiz.timeLimitSeconds,
    updatedAt: quiz.updatedAt
  };
}

function findSessionByCode(code) {
  return getState().sessions.find((session) => session.roomCode === String(code).toUpperCase());
}

function sessionQuiz(session) {
  return getState().quizzes.find((quiz) => quiz.id === session.quizId);
}

function activeQuestion(session) {
  const quiz = sessionQuiz(session);
  if (!quiz || session.currentQuestionIndex < 0) return null;
  return quiz.questions[session.currentQuestionIndex] || null;
}

function correctOptionIds(question) {
  return question.options.filter((option) => option.isCorrect).map((option) => option.id);
}

function scoreRows(session) {
  return [...session.participants]
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'ru'))
    .map((participant, index) => ({
      rank: index + 1,
      userId: participant.userId,
      name: participant.name,
      score: participant.score
    }));
}

function sanitizedSessionState(session, viewer) {
  const quiz = sessionQuiz(session);
  const question = activeQuestion(session);
  const participant = session.participants.find((entry) => entry.userId === viewer.id);
  const answer = question && session.answers[String(session.currentQuestionIndex)]?.[viewer.id];
  const reveal = session.status === 'review' || session.status === 'finished';

  return {
    id: session.id,
    roomCode: session.roomCode,
    status: session.status,
    currentQuestionIndex: session.currentQuestionIndex,
    totalQuestions: quiz?.questions.length || 0,
    questionEndsAt: session.questionEndsAt,
    participantCount: session.participants.length,
    quiz: quiz
      ? {
          id: quiz.id,
          title: quiz.title,
          categories: quiz.categories,
          rules: quiz.rules,
          timeLimitSeconds: quiz.timeLimitSeconds
        }
      : null,
    currentQuestion: question
      ? {
          id: question.id,
          prompt: question.prompt,
          imageUrl: question.imageUrl,
          selectionMode: question.selectionMode,
          options: question.options.map((option) => ({
            id: option.id,
            text: option.text,
            isCorrect: reveal ? option.isCorrect : undefined
          }))
        }
      : null,
    hasAnswered: Boolean(answer),
    myAnswer: answer || null,
    myScore: participant?.score || 0,
    scoreboard: scoreRows(session)
  };
}

async function persistAndBroadcast(session) {
  await mutate(() => session);
  emitSession(session);
}

function emitSession(session) {
  for (const socket of io.sockets.adapter.rooms.get(session.roomCode) || []) {
    const client = io.sockets.sockets.get(socket);
    if (client?.user) {
      client.emit('session:state', sanitizedSessionState(session, client.user));
    }
  }
}

function clearQuestionTimer(sessionId) {
  const timer = questionTimers.get(sessionId);
  if (timer) clearTimeout(timer);
  questionTimers.delete(sessionId);
}

function scheduleQuestionClose(session) {
  clearQuestionTimer(session.id);
  const delay = Math.max(0, Number(session.questionEndsAt) - Date.now());
  const timer = setTimeout(async () => {
    const current = getState().sessions.find((item) => item.id === session.id);
    if (!current || current.status !== 'question') return;
    current.status = 'review';
    current.updatedAt = new Date().toISOString();
    await persistAndBroadcast(current);
  }, delay);
  questionTimers.set(session.id, timer);
}

async function moveToQuestion(session, index) {
  const quiz = sessionQuiz(session);
  if (!quiz || !quiz.questions[index]) return;
  session.status = 'question';
  session.currentQuestionIndex = index;
  session.questionEndsAt = Date.now() + Number(quiz.timeLimitSeconds || 30) * 1000;
  session.answers[String(index)] = session.answers[String(index)] || {};
  session.updatedAt = new Date().toISOString();
  scheduleQuestionClose(session);
  await persistAndBroadcast(session);
}

async function finishSession(session) {
  clearQuestionTimer(session.id);
  session.status = 'finished';
  session.questionEndsAt = null;
  session.finishedAt = new Date().toISOString();
  session.updatedAt = session.finishedAt;
  await persistAndBroadcast(session);
}

function validateQuizPayload(body) {
  const title = String(body.title || '').trim();
  if (!title) return 'Название квиза обязательно';
  const questions = Array.isArray(body.questions) ? body.questions : [];
  if (questions.length === 0) return 'Добавьте минимум один вопрос';

  for (const [index, question] of questions.entries()) {
    if (!String(question.prompt || '').trim() && !String(question.imageUrl || '').trim()) {
      return `Вопрос ${index + 1}: нужен текст или изображение`;
    }
    const options = Array.isArray(question.options) ? question.options : [];
    if (options.length < 2) return `Вопрос ${index + 1}: нужно минимум два варианта`;
    const correctCount = options.filter((option) => option.isCorrect).length;
    if (correctCount === 0) return `Вопрос ${index + 1}: отметьте правильный ответ`;
    if (question.selectionMode === 'single' && correctCount !== 1) {
      return `Вопрос ${index + 1}: одиночный выбор требует один правильный ответ`;
    }
  }

  return null;
}

function normalizeQuizPayload(body, organizerId, existing = {}) {
  const now = new Date().toISOString();
  return {
    id: existing.id || id('quiz'),
    organizerId,
    title: String(body.title || '').trim(),
    categories: String(body.categoriesText || '')
      .split(',')
      .map((category) => category.trim())
      .filter(Boolean),
    timeLimitSeconds: Math.max(10, Math.min(180, Number(body.timeLimitSeconds || 30))),
    rules: String(body.rules || '').trim(),
    questions: body.questions.map((question) => ({
      id: question.id || id('q'),
      prompt: String(question.prompt || '').trim(),
      imageUrl: String(question.imageUrl || '').trim(),
      selectionMode: question.selectionMode === 'multiple' ? 'multiple' : 'single',
      options: question.options.map((option) => ({
        id: option.id || id('opt'),
        text: String(option.text || '').trim(),
        isCorrect: Boolean(option.isCorrect)
      }))
    })),
    createdAt: existing.createdAt || now,
    updatedAt: now
  };
}

app.post('/api/auth/register', async (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const role = req.body.role === 'organizer' ? 'organizer' : 'participant';

  if (!name || !email || password.length < 6) {
    return res.status(400).json({ error: 'Укажите имя, email и пароль от 6 символов' });
  }

  const existing = getState().users.find((user) => user.email === email);
  if (existing) return res.status(409).json({ error: 'Пользователь с таким email уже есть' });

  const passwordHash = hashPassword(password);
  const user = {
    id: id('user'),
    name,
    email,
    role,
    passwordHash,
    createdAt: new Date().toISOString()
  };

  await mutate((state) => state.users.push(user));
  res.status(201).json({ user: publicUser(user), token: createToken(user, TOKEN_SECRET) });
});

app.post('/api/auth/login', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const user = getState().users.find((entry) => entry.email === email);

  if (!user || !verifyPassword(password, user.passwordHash.salt, user.passwordHash.hash)) {
    return res.status(401).json({ error: 'Неверный email или пароль' });
  }

  res.json({ user: publicUser(user), token: createToken(user, TOKEN_SECRET) });
});

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

app.get('/api/quizzes', requireAuth, requireOrganizer, (req, res) => {
  const quizzes = getState().quizzes
    .filter((quiz) => quiz.organizerId === req.user.id)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map(compactQuiz);
  res.json({ quizzes });
});

app.post('/api/quizzes', requireAuth, requireOrganizer, async (req, res) => {
  const error = validateQuizPayload(req.body);
  if (error) return res.status(400).json({ error });
  const quiz = normalizeQuizPayload(req.body, req.user.id);
  await mutate((state) => state.quizzes.push(quiz));
  res.status(201).json({ quiz: publicQuiz(quiz, true) });
});

app.get('/api/quizzes/:id', requireAuth, requireOrganizer, (req, res) => {
  const quiz = getState().quizzes.find((item) => item.id === req.params.id && item.organizerId === req.user.id);
  if (!quiz) return res.status(404).json({ error: 'Квиз не найден' });
  res.json({ quiz: publicQuiz(quiz, true) });
});

app.put('/api/quizzes/:id', requireAuth, requireOrganizer, async (req, res) => {
  const quiz = getState().quizzes.find((item) => item.id === req.params.id && item.organizerId === req.user.id);
  if (!quiz) return res.status(404).json({ error: 'Квиз не найден' });
  const error = validateQuizPayload(req.body);
  if (error) return res.status(400).json({ error });
  const updated = normalizeQuizPayload(req.body, req.user.id, quiz);
  await mutate((state) => {
    const index = state.quizzes.findIndex((item) => item.id === quiz.id);
    state.quizzes[index] = updated;
  });
  res.json({ quiz: publicQuiz(updated, true) });
});

app.post('/api/quizzes/:id/launch', requireAuth, requireOrganizer, async (req, res) => {
  const quiz = getState().quizzes.find((item) => item.id === req.params.id && item.organizerId === req.user.id);
  if (!quiz) return res.status(404).json({ error: 'Квиз не найден' });

  let code = roomCode();
  while (findSessionByCode(code)) code = roomCode();

  const now = new Date().toISOString();
  const session = {
    id: id('session'),
    roomCode: code,
    quizId: quiz.id,
    organizerId: req.user.id,
    status: 'waiting',
    currentQuestionIndex: -1,
    questionEndsAt: null,
    participants: [],
    answers: {},
    createdAt: now,
    updatedAt: now,
    finishedAt: null
  };

  await mutate((state) => state.sessions.push(session));
  res.status(201).json({ session: sanitizedSessionState(session, req.user) });
});

app.get('/api/history', requireAuth, (req, res) => {
  if (req.user.role === 'organizer') {
    const sessions = getState().sessions
      .filter((session) => session.organizerId === req.user.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((session) => ({
        id: session.id,
        roomCode: session.roomCode,
        status: session.status,
        quizTitle: sessionQuiz(session)?.title || 'Квиз удален',
        createdAt: session.createdAt,
        finishedAt: session.finishedAt,
        participants: session.participants.length,
        winners: scoreRows(session).slice(0, 3)
      }));
    return res.json({ sessions });
  }

  const sessions = getState().sessions
    .filter((session) => session.participants.some((participant) => participant.userId === req.user.id))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((session) => {
      const participant = session.participants.find((entry) => entry.userId === req.user.id);
      return {
        id: session.id,
        roomCode: session.roomCode,
        status: session.status,
        quizTitle: sessionQuiz(session)?.title || 'Квиз удален',
        score: participant?.score || 0,
        rank: scoreRows(session).find((row) => row.userId === req.user.id)?.rank || null,
        createdAt: session.createdAt,
        finishedAt: session.finishedAt
      };
    });
  res.json({ sessions });
});

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(clientDistPath));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
    return res.sendFile(path.join(clientDistPath, 'index.html'));
  });
}

io.use((socket, next) => {
  const token = socket.handshake.auth?.token || socket.handshake.headers.authorization?.replace('Bearer ', '');
  const user = getUserByToken(token);
  if (!user) return next(new Error('unauthorized'));
  socket.user = publicUser(user);
  next();
});

io.on('connection', (socket) => {
  socket.on('session:hostJoin', async ({ roomCode: code }, callback) => {
    const session = findSessionByCode(code);
    if (!session || session.organizerId !== socket.user.id) {
      callback?.({ ok: false, error: 'Сессия не найдена' });
      return;
    }
    socket.join(session.roomCode);
    callback?.({ ok: true });
    socket.emit('session:state', sanitizedSessionState(session, socket.user));
  });

  socket.on('session:join', async ({ roomCode: code }, callback) => {
    const session = findSessionByCode(code);
    if (!session || session.status === 'finished') {
      callback?.({ ok: false, error: 'Активная комната не найдена' });
      return;
    }

    socket.join(session.roomCode);
    if (!session.participants.some((participant) => participant.userId === socket.user.id)) {
      session.participants.push({
        userId: socket.user.id,
        name: socket.user.name,
        score: 0,
        joinedAt: new Date().toISOString()
      });
      await mutate(() => session);
    }

    callback?.({ ok: true });
    emitSession(session);
  });

  socket.on('session:start', async ({ roomCode: code }, callback) => {
    const session = findSessionByCode(code);
    if (!session || session.organizerId !== socket.user.id) {
      callback?.({ ok: false, error: 'Нет доступа' });
      return;
    }
    if (session.status !== 'waiting') {
      callback?.({ ok: false, error: 'Квиз уже запущен' });
      return;
    }
    callback?.({ ok: true });
    await moveToQuestion(session, 0);
  });

  socket.on('session:next', async ({ roomCode: code }, callback) => {
    const session = findSessionByCode(code);
    if (!session || session.organizerId !== socket.user.id) {
      callback?.({ ok: false, error: 'Нет доступа' });
      return;
    }
    const quiz = sessionQuiz(session);
    if (!quiz) {
      callback?.({ ok: false, error: 'Квиз не найден' });
      return;
    }
    callback?.({ ok: true });
    if (session.currentQuestionIndex + 1 >= quiz.questions.length) {
      await finishSession(session);
    } else {
      await moveToQuestion(session, session.currentQuestionIndex + 1);
    }
  });

  socket.on('session:finish', async ({ roomCode: code }, callback) => {
    const session = findSessionByCode(code);
    if (!session || session.organizerId !== socket.user.id) {
      callback?.({ ok: false, error: 'Нет доступа' });
      return;
    }
    callback?.({ ok: true });
    await finishSession(session);
  });

  socket.on('answer:submit', async ({ roomCode: code, optionIds }, callback) => {
    const session = findSessionByCode(code);
    if (!session || session.status !== 'question') {
      callback?.({ ok: false, error: 'Ответы сейчас закрыты' });
      return;
    }
    if (Date.now() > Number(session.questionEndsAt)) {
      session.status = 'review';
      await persistAndBroadcast(session);
      callback?.({ ok: false, error: 'Время вышло' });
      return;
    }

    const participant = session.participants.find((entry) => entry.userId === socket.user.id);
    if (!participant) {
      callback?.({ ok: false, error: 'Сначала подключитесь к комнате' });
      return;
    }

    const answerBucket = session.answers[String(session.currentQuestionIndex)] || {};
    if (answerBucket[socket.user.id]) {
      callback?.({ ok: false, error: 'Ответ уже отправлен' });
      return;
    }

    const question = activeQuestion(session);
    const allowedIds = new Set(question.options.map((option) => option.id));
    const selectedOptionIds = (Array.isArray(optionIds) ? optionIds : []).map(String).filter((item) => allowedIds.has(item));
    if (selectedOptionIds.length === 0) {
      callback?.({ ok: false, error: 'Выберите вариант' });
      return;
    }

    const result = calculatePoints({
      selectedOptionIds,
      correctOptionIds: correctOptionIds(question),
      deadline: session.questionEndsAt,
      answeredAt: Date.now()
    });

    participant.score += result.points;
    answerBucket[socket.user.id] = {
      optionIds: selectedOptionIds,
      correct: result.correct,
      points: result.points,
      answeredAt: new Date().toISOString()
    };
    session.answers[String(session.currentQuestionIndex)] = answerBucket;
    session.updatedAt = new Date().toISOString();

    await persistAndBroadcast(session);
    callback?.({ ok: true, result });
  });
});

for (const session of getState().sessions.filter((item) => item.status === 'question')) {
  scheduleQuestionClose(session);
}

server.listen(PORT, () => {
  const protocol = tlsEnabled ? 'https' : 'http';
  console.log(`QuizRoom API listening on ${protocol}://127.0.0.1:${PORT}`);
});
