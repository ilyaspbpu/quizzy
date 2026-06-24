import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { io } from 'socket.io-client';
import {
  BarChart3,
  Check,
  ChevronRight,
  Clock3,
  Copy,
  Flag,
  History,
  Image,
  ListChecks,
  LogOut,
  Play,
  Plus,
  Radio,
  Save,
  Send,
  Settings,
  ShieldCheck,
  Trophy,
  UserRound,
  UsersRound,
  X
} from 'lucide-react';
import './styles.css';

const API_URL = import.meta.env.VITE_API_URL || '';
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || (import.meta.env.DEV ? 'http://127.0.0.1:4000' : window.location.origin);
const emptyQuestion = () => ({
  id: crypto.randomUUID(),
  prompt: '',
  imageUrl: '',
  selectionMode: 'single',
  options: [
    { id: crypto.randomUUID(), text: '', isCorrect: true },
    { id: crypto.randomUUID(), text: '', isCorrect: false }
  ]
});

const starterQuiz = {
  title: 'Квиз по продукту',
  categoriesText: 'общие знания, командная игра',
  timeLimitSeconds: 30,
  rules: 'За правильный ответ начисляется 1000 баллов и бонус за скорость.',
  questions: [
    {
      id: crypto.randomUUID(),
      prompt: 'Какой формат ответа поддерживает этот MVP?',
      imageUrl: '',
      selectionMode: 'multiple',
      options: [
        { id: crypto.randomUUID(), text: 'Одиночный выбор', isCorrect: true },
        { id: crypto.randomUUID(), text: 'Множественный выбор', isCorrect: true },
        { id: crypto.randomUUID(), text: 'Только свободный текст', isCorrect: false }
      ]
    }
  ]
};

function api(token) {
  return async (path, options = {}) => {
    const response = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {})
      }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Ошибка запроса');
    return payload;
  };
}

function formatDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value));
}

function Field({ label, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function Button({ children, icon: Icon, variant = 'primary', ...props }) {
  return (
    <button className={`button ${variant}`} {...props}>
      {Icon && <Icon size={18} />}
      <span>{children}</span>
    </button>
  );
}

function IconButton({ label, icon: Icon, ...props }) {
  return (
    <button className="icon-button" aria-label={label} title={label} {...props}>
      <Icon size={18} />
    </button>
  );
}

function AuthScreen({ onAuth }) {
  const [mode, setMode] = useState('login');
  const [role, setRole] = useState('organizer');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const request = api('');

  async function submit(event) {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      const payload = mode === 'login'
        ? { email: form.email, password: form.password }
        : { ...form, role };
      const result = await request(`/api/auth/${mode === 'login' ? 'login' : 'register'}`, {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      onAuth(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-shell">
        <div className="brand-panel">
          <div className="brand-mark"><Trophy size={34} /></div>
          <h1>QuizRoom</h1>
          <p>Прототип для живых квизов</p>
          <div className="feature-strip">
            <span><ShieldCheck size={16} /> роли</span>
            <span><Clock3 size={16} /> таймер</span>
            <span><BarChart3 size={16} /> таблица участников</span>
          </div>
        </div>
        <form className="auth-form" onSubmit={submit}>
          <div className="segmented" role="tablist">
            <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>Вход</button>
            <button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>Регистрация</button>
          </div>
          {mode === 'register' && (
            <>
              <Field label="Роль">
                <div className="role-toggle">
                  <button type="button" className={role === 'organizer' ? 'selected' : ''} onClick={() => setRole('organizer')}>
                    <Settings size={16} /> Организатор
                  </button>
                  <button type="button" className={role === 'participant' ? 'selected' : ''} onClick={() => setRole('participant')}>
                    <UserRound size={16} /> Участник
                  </button>
                </div>
              </Field>
              <Field label="Имя">
                <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Анна" />
              </Field>
            </>
          )}
          <Field label="Email">
            <input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="user@example.com" />
          </Field>
          <Field label="Пароль">
            <input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} placeholder="минимум 6 символов" />
          </Field>
          {error && <div className="alert error">{error}</div>}
          <Button icon={mode === 'login' ? ChevronRight : Check} disabled={loading}>{loading ? 'Подождите' : mode === 'login' ? 'Войти' : 'Создать аккаунт'}</Button>
        </form>
      </section>
    </main>
  );
}

function App() {
  const [token, setToken] = useState(localStorage.getItem('quiz-token') || '');
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(Boolean(token));

  useEffect(() => {
    if (!token) return;
    api(token)('/api/me')
      .then(({ user }) => setUser(user))
      .catch(() => {
        localStorage.removeItem('quiz-token');
        setToken('');
      })
      .finally(() => setLoading(false));
  }, [token]);

  function handleAuth({ token: nextToken, user: nextUser }) {
    localStorage.setItem('quiz-token', nextToken);
    setToken(nextToken);
    setUser(nextUser);
  }

  function logout() {
    localStorage.removeItem('quiz-token');
    setToken('');
    setUser(null);
  }

  if (loading) return <div className="loading">Загрузка...</div>;
  if (!user) return <AuthScreen onAuth={handleAuth} />;

  return (
    <Dashboard user={user} token={token} onLogout={logout} />
  );
}

function Dashboard({ user, token, onLogout }) {
  const [tab, setTab] = useState(user.role === 'organizer' ? 'builder' : 'join');
  const request = useMemo(() => api(token), [token]);

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="logo-row">
          <div className="small-mark"><Trophy size={21} /></div>
          <div>
            <strong>QuizRoom</strong>
            <span>{user.role === 'organizer' ? 'организатор' : 'участник'}</span>
          </div>
        </div>
        <nav>
          {user.role === 'organizer' ? (
            <>
              <button className={tab === 'builder' ? 'active' : ''} onClick={() => setTab('builder')}><ListChecks size={18} /> Конструктор</button>
              <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}><History size={18} /> История</button>
            </>
          ) : (
            <>
              <button className={tab === 'join' ? 'active' : ''} onClick={() => setTab('join')}><Play size={18} /> Комната</button>
              <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}><History size={18} /> История</button>
            </>
          )}
        </nav>
        <button className="logout" onClick={onLogout}><LogOut size={18} /> Выйти</button>
      </aside>
      <section className="workspace">
        <header className="topbar">
          <div>
            <p>{user.name}</p>
            <h2>{user.role === 'organizer' ? 'Мои квизы' : 'Кабинет участника'}</h2>
          </div>
          <div className="status-pill"><UsersRound size={16} /> WebSocket online</div>
        </header>
        {user.role === 'organizer' && tab === 'builder' && <OrganizerBuilder token={token} request={request} />}
        {user.role === 'participant' && tab === 'join' && <ParticipantJoin token={token} />}
        {tab === 'history' && <HistoryView request={request} role={user.role} />}
      </section>
    </main>
  );
}

function OrganizerBuilder({ token, request }) {
  const [quiz, setQuiz] = useState(starterQuiz);
  const [quizzes, setQuizzes] = useState([]);
  const [selectedQuestion, setSelectedQuestion] = useState(0);
  const [message, setMessage] = useState('');
  const [hostRoom, setHostRoom] = useState('');

  const loadQuizzes = useCallback(async () => {
    const result = await request('/api/quizzes');
    setQuizzes(result.quizzes);
  }, [request]);

  useEffect(() => {
    loadQuizzes().catch((err) => setMessage(err.message));
  }, [loadQuizzes]);

  function updateQuestion(index, patch) {
    setQuiz((current) => ({
      ...current,
      questions: current.questions.map((question, itemIndex) => itemIndex === index ? { ...question, ...patch } : question)
    }));
  }

  function updateOption(questionIndex, optionIndex, patch) {
    setQuiz((current) => ({
      ...current,
      questions: current.questions.map((question, itemIndex) => {
        if (itemIndex !== questionIndex) return question;
        const nextOptions = question.options.map((option, index) => index === optionIndex ? { ...option, ...patch } : option);
        if (question.selectionMode === 'single' && patch.isCorrect) {
          return { ...question, options: nextOptions.map((option, index) => ({ ...option, isCorrect: index === optionIndex })) };
        }
        return { ...question, options: nextOptions };
      })
    }));
  }

  function removeOption(questionIndex, optionIndex) {
    setQuiz((current) => ({
      ...current,
      questions: current.questions.map((question, itemIndex) => {
        if (itemIndex !== questionIndex || question.options.length <= 2) return question;
        let nextOptions = question.options.filter((_, index) => index !== optionIndex);
        if (!nextOptions.some((option) => option.isCorrect)) {
          nextOptions = nextOptions.map((option, index) => ({ ...option, isCorrect: index === 0 }));
        }
        return { ...question, options: nextOptions };
      })
    }));
  }

  function addQuestion() {
    setQuiz((current) => ({ ...current, questions: [...current.questions, emptyQuestion()] }));
    setSelectedQuestion(quiz.questions.length);
  }

  function removeQuestion(index) {
    setQuiz((current) => ({ ...current, questions: current.questions.filter((_, itemIndex) => itemIndex !== index) }));
    setSelectedQuestion(0);
  }

  function uploadQuestionImage(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setMessage('Добавьте файл изображения');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => updateQuestion(selectedQuestion, { imageUrl: reader.result });
    reader.readAsDataURL(file);
  }

  async function saveQuiz() {
    setMessage('');
    try {
      const result = await request(quiz.id ? `/api/quizzes/${quiz.id}` : '/api/quizzes', {
        method: quiz.id ? 'PUT' : 'POST',
        body: JSON.stringify(quiz)
      });
      setQuiz({
        ...result.quiz,
        categoriesText: result.quiz.categories.join(', ')
      });
      setMessage('Квиз сохранен');
      await loadQuizzes();
    } catch (err) {
      setMessage(err.message);
    }
  }

  async function loadQuiz(id) {
    const result = await request(`/api/quizzes/${id}`);
    setQuiz({ ...result.quiz, categoriesText: result.quiz.categories.join(', ') });
    setSelectedQuestion(0);
  }

  async function launchQuiz(id = quiz.id) {
    setMessage('');
    try {
      if (!id) {
        await saveQuiz();
        return;
      }
      const result = await request(`/api/quizzes/${id}/launch`, { method: 'POST', body: '{}' });
      setHostRoom(result.session.roomCode);
    } catch (err) {
      setMessage(err.message);
    }
  }

  const question = quiz.questions[selectedQuestion] || quiz.questions[0];

  return (
    <div className="builder-grid">
      <section className="builder-main">
        <div className="section-title">
          <div>
            <p>Настройка</p>
            <h3>Создание квиза</h3>
          </div>
          <Button icon={Save} onClick={saveQuiz}>Сохранить</Button>
        </div>
        <div className="form-grid">
          <Field label="Название">
            <input value={quiz.title} onChange={(event) => setQuiz({ ...quiz, title: event.target.value })} />
          </Field>
          <Field label="Категории через запятую">
            <input value={quiz.categoriesText || ''} onChange={(event) => setQuiz({ ...quiz, categoriesText: event.target.value })} />
          </Field>
          <Field label="Время на вопрос, сек.">
            <input type="number" min="10" max="180" value={quiz.timeLimitSeconds} onChange={(event) => setQuiz({ ...quiz, timeLimitSeconds: event.target.value })} />
          </Field>
          <Field label="Правила">
            <textarea value={quiz.rules} onChange={(event) => setQuiz({ ...quiz, rules: event.target.value })} />
          </Field>
        </div>
        <div className="question-layout">
          <div className="question-list">
            <div className="list-header">
              <span>Вопросы</span>
              <IconButton icon={Plus} label="Добавить вопрос" onClick={addQuestion} />
            </div>
            {quiz.questions.map((item, index) => (
              <button key={item.id} className={selectedQuestion === index ? 'selected' : ''} onClick={() => setSelectedQuestion(index)}>
                <span>{index + 1}</span>
                <strong>{item.prompt || item.imageUrl || 'Новый вопрос'}</strong>
              </button>
            ))}
          </div>
          {question && (
            <div className="question-editor">
              <div className="editor-toolbar">
                <div className="segmented compact">
                  <button type="button" className={question.selectionMode === 'single' ? 'active' : ''} onClick={() => updateQuestion(selectedQuestion, { selectionMode: 'single' })}>Один ответ</button>
                  <button type="button" className={question.selectionMode === 'multiple' ? 'active' : ''} onClick={() => updateQuestion(selectedQuestion, { selectionMode: 'multiple' })}>Несколько</button>
                </div>
                {quiz.questions.length > 1 && <IconButton icon={X} label="Удалить вопрос" onClick={() => removeQuestion(selectedQuestion)} />}
              </div>
              <Field label="Текст вопроса">
                <textarea value={question.prompt} onChange={(event) => updateQuestion(selectedQuestion, { prompt: event.target.value })} />
              </Field>
              <div
                className="image-dropzone"
                role="button"
                tabIndex="0"
                onClick={() => document.getElementById(`image-upload-${question.id}`)?.click()}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') document.getElementById(`image-upload-${question.id}`)?.click();
                }}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  uploadQuestionImage(event.dataTransfer.files?.[0]);
                }}
              >
                <input
                  id={`image-upload-${question.id}`}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(event) => uploadQuestionImage(event.target.files?.[0])}
                />
                <Image size={22} />
                <div>
                  <strong>{question.imageUrl ? 'Заменить изображение' : 'Добавить изображение'}</strong>
                  <span>Перетащите файл сюда или нажмите для выбора</span>
                </div>
                {question.imageUrl && (
                  <IconButton
                    icon={X}
                    label="Удалить изображение"
                    onClick={(event) => {
                      event.stopPropagation();
                      updateQuestion(selectedQuestion, { imageUrl: '' });
                    }}
                  />
                )}
              </div>
              {question.imageUrl && <img className="question-preview" src={question.imageUrl} alt="Предпросмотр вопроса" />}
              <div className="options-list">
                {question.options.map((option, index) => (
                  <div className="option-row" key={option.id}>
                    <input
                      type={question.selectionMode === 'single' ? 'radio' : 'checkbox'}
                      checked={option.isCorrect}
                      onChange={(event) => updateOption(selectedQuestion, index, { isCorrect: event.target.checked })}
                    />
                    <input value={option.text} onChange={(event) => updateOption(selectedQuestion, index, { text: event.target.value })} placeholder={`Вариант ${index + 1}`} />
                    {question.options.length > 2 && (
                      <IconButton icon={X} label="Удалить вариант" onClick={() => removeOption(selectedQuestion, index)} />
                    )}
                  </div>
                ))}
                <Button
                  icon={Plus}
                  variant="secondary"
                  onClick={() => updateQuestion(selectedQuestion, { options: [...question.options, { id: crypto.randomUUID(), text: '', isCorrect: false }] })}
                >
                  Добавить вариант
                </Button>
              </div>
            </div>
          )}
        </div>
        {message && <div className={`alert ${message.includes('сохранен') ? 'success' : 'error'}`}>{message}</div>}
      </section>
      <aside className="builder-side">
        <div className="section-title small">
          <div>
            <p>Запуск</p>
            <h3>Сохраненные квизы</h3>
          </div>
        </div>
        <div className="quiz-list">
          {quizzes.map((item) => (
            <article key={item.id}>
              <div>
                <h4>{item.title}</h4>
                <p>{item.questionCount} вопросов · {item.timeLimitSeconds} сек.</p>
              </div>
              <div className="row-actions">
                <IconButton icon={ListChecks} label="Открыть" onClick={() => loadQuiz(item.id)} />
                <IconButton icon={Play} label="Запустить" onClick={() => launchQuiz(item.id)} />
              </div>
            </article>
          ))}
          {quizzes.length === 0 && <p className="empty">Сохраните первый квиз.</p>}
        </div>
        {hostRoom && <HostPanel token={token} roomCode={hostRoom} />}
      </aside>
    </div>
  );
}

function useSessionSocket(token, joinEvent, roomCode) {
  const [session, setSession] = useState(null);
  const [error, setError] = useState('');
  const [socket, setSocket] = useState(null);

  useEffect(() => {
    if (!roomCode) return undefined;
    const client = io(SOCKET_URL, { auth: { token } });
    setSocket(client);
    client.on('connect', () => {
      client.emit(joinEvent, { roomCode }, (response) => {
        if (!response?.ok) setError(response?.error || 'Не удалось подключиться');
      });
    });
    client.on('session:state', setSession);
    client.on('connect_error', () => setError('Ошибка WebSocket-подключения'));
    return () => client.disconnect();
  }, [token, joinEvent, roomCode]);

  return { session, error, socket, setError };
}

function HostPanel({ token, roomCode }) {
  const { session, error, socket } = useSessionSocket(token, 'session:hostJoin', roomCode);

  function emit(event) {
    socket?.emit(event, { roomCode });
  }

  if (error) return <div className="alert error">{error}</div>;
  if (!session) return <div className="live-panel">Подключение к комнате...</div>;

  return (
    <div className="live-panel">
      <div className="room-code">
        <span>Код комнаты</span>
        <strong>{session.roomCode}</strong>
        <IconButton icon={Copy} label="Скопировать код" onClick={() => navigator.clipboard?.writeText(session.roomCode)} />
      </div>
      <p className="muted">{session.participantCount} участников</p>
      <LiveQuestion session={session} host />
      <div className="control-row">
        {session.status === 'waiting' && <Button icon={Play} onClick={() => emit('session:start')}>Старт</Button>}
        {(session.status === 'review' || session.status === 'question') && <Button icon={ChevronRight} onClick={() => emit('session:next')}>Следующий этап</Button>}
        {session.status !== 'finished' && <Button icon={Flag} variant="secondary" onClick={() => emit('session:finish')}>Завершить</Button>}
      </div>
      <Leaderboard rows={session.scoreboard} />
    </div>
  );
}

function ParticipantJoin({ token }) {
  const [code, setCode] = useState('');
  const [roomCode, setRoomCode] = useState('');

  if (roomCode) {
    return <ParticipantRoom token={token} roomCode={roomCode} onLeave={() => setRoomCode('')} />;
  }

  return (
    <section className="join-view">
      <div className="join-copy">
        <p>Подключение</p>
        <h3>Введите код комнаты</h3>
      </div>
      <div className="join-form">
        <input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="ABC123" maxLength={6} />
        <Button icon={Play} onClick={() => setRoomCode(code.trim())} disabled={code.trim().length < 4}>Войти</Button>
      </div>
    </section>
  );
}

function ParticipantRoom({ token, roomCode, onLeave }) {
  const { session, error, socket, setError } = useSessionSocket(token, 'session:join', roomCode);
  const [selected, setSelected] = useState([]);

  useEffect(() => {
    setSelected([]);
  }, [session?.currentQuestion?.id]);

  function toggleOption(optionId, mode) {
    setSelected((current) => {
      if (mode === 'single') return [optionId];
      return current.includes(optionId) ? current.filter((id) => id !== optionId) : [...current, optionId];
    });
  }

  function submitAnswer() {
    socket?.emit('answer:submit', { roomCode, optionIds: selected }, (response) => {
      if (!response?.ok) setError(response?.error || 'Ответ не принят');
    });
  }

  return (
    <section className="participant-room">
      <div className="room-header">
        <div>
          <p>Комната {roomCode}</p>
          <h3>{session?.quiz?.title || 'Подключение...'}</h3>
        </div>
        <Button icon={X} variant="secondary" onClick={onLeave}>Выйти</Button>
      </div>
      {error && <div className="alert error">{error}</div>}
      {session && (
        <>
          <LiveQuestion session={session} selected={selected} onToggle={toggleOption} />
          {session.status === 'question' && !session.hasAnswered && (
            <Button icon={Send} onClick={submitAnswer} disabled={selected.length === 0}>Отправить ответ</Button>
          )}
          {session.hasAnswered && <div className="alert success">Ответ принят. Баллы за вопрос: {session.myAnswer?.points || 0}</div>}
          <Leaderboard rows={session.scoreboard} />
        </>
      )}
    </section>
  );
}

function LiveQuestion({ session, selected = [], onToggle, host = false }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);

  if (session.status === 'waiting') {
    return <div className="state-box"><UsersRound size={24} /> Ожидание участников</div>;
  }

  if (session.status === 'finished') {
    return <div className="state-box"><Trophy size={24} /> Квиз завершен</div>;
  }

  const question = session.currentQuestion;
  const remaining = Math.max(0, Math.ceil((Number(session.questionEndsAt) - now) / 1000));
  const progress = session.quiz?.timeLimitSeconds ? Math.max(0, Math.min(100, (remaining / session.quiz.timeLimitSeconds) * 100)) : 0;

  return (
    <article className="live-question">
      <div className="question-meta">
        <span>Вопрос {session.currentQuestionIndex + 1} из {session.totalQuestions}</span>
        <span className={remaining < 6 ? 'danger' : ''}><Clock3 size={16} /> {session.status === 'question' ? `${remaining} сек.` : 'ответы закрыты'}</span>
      </div>
      <div className="timer-bar"><span style={{ width: `${progress}%` }} /></div>
      {question?.imageUrl && <img className="live-image" src={question.imageUrl} alt="Изображение вопроса" />}
      <h4>{question?.prompt || 'Вопрос с изображением'}</h4>
      <div className="answer-grid">
        {question?.options.map((option) => {
          const checked = selected.includes(option.id);
          const revealed = option.isCorrect !== undefined;
          return (
            <button
              key={option.id}
              className={`answer-option ${checked ? 'checked' : ''} ${revealed && option.isCorrect ? 'correct' : ''}`}
              onClick={() => onToggle?.(option.id, question.selectionMode)}
              disabled={host || session.status !== 'question' || session.hasAnswered}
            >
              {question.selectionMode === 'single' ? <Radio size={17} /> : <Check size={17} />}
              <span>{option.text}</span>
            </button>
          );
        })}
      </div>
    </article>
  );
}

function Leaderboard({ rows }) {
  return (
    <section className="leaderboard">
      <div className="section-title small">
        <div>
          <p>Баллы</p>
          <h3>Таблица участников</h3>
        </div>
      </div>
      <div className="score-table">
        {rows.map((row) => (
          <div key={row.userId}>
            <strong>{row.rank}</strong>
            <span>{row.name}</span>
            <b>{row.score}</b>
          </div>
        ))}
        {rows.length === 0 && <p className="empty">Пока нет участников.</p>}
      </div>
    </section>
  );
}

function HistoryView({ request, role }) {
  const [sessions, setSessions] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    request('/api/history')
      .then((result) => setSessions(result.sessions))
      .catch((err) => setError(err.message));
  }, [request]);

  return (
    <section className="history-view">
      <div className="section-title">
        <div>
          <p>Личный кабинет</p>
          <h3>{role === 'organizer' ? 'Проведенные квизы' : 'История участия'}</h3>
        </div>
      </div>
      {error && <div className="alert error">{error}</div>}
      <div className="history-list">
        {sessions.map((session) => (
          <article key={session.id}>
            <div>
              <h4>{session.quizTitle}</h4>
              <p>{session.roomCode} · {formatDate(session.createdAt)} · {session.status}</p>
            </div>
            {role === 'organizer' ? (
              <span>{session.participants} участников</span>
            ) : (
              <span>{session.rank ? `${session.rank} место · ${session.score} баллов` : `${session.score} баллов`}</span>
            )}
          </article>
        ))}
        {sessions.length === 0 && <p className="empty">История появится после первого квиза.</p>}
      </div>
    </section>
  );
}

createRoot(document.getElementById('root')).render(<App />);
