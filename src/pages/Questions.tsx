import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../components/AuthProvider';
import { supabase } from '../lib/supabase';

type DailyQuestion = {
  question_date: string;
  question_id: string;
  prompt: string;
  category: string;
  progression_year: number;
  depth: string;
  journey_day: number;
};

type SpaceRow = {
  space_id: string;
  member_id: string;
  member_display_name: string | null;
};

type AnswerVisibility = 'private' | 'shared' | 'after_both';
type QuestionAnswer = {
  id: string;
  author: string;
  answer: string;
  visibility: AnswerVisibility;
  updated_at: string;
};
type QuestionComment = { id: string; answer_id: string; author: string; comment: string; created_at: string };
type QuestionReaction = { answer_id: string; user_id: string; reaction: 'heart' | 'laugh' | 'support' | 'wow' };
type HistoryRow = { question_date: string; prompt: string; category: string; answer_id: string | null; answer: string | null; visibility: AnswerVisibility | null; author: string | null };

const ANSWER_COLUMNS = 'id,author,answer,visibility,updated_at';
const QUESTION_REACTIONS = [
  { value: 'heart', icon: '♥', label: 'Heart' },
  { value: 'laugh', icon: '☺', label: 'Laugh' },
  { value: 'support', icon: '✦', label: 'Support' },
  { value: 'wow', icon: '!', label: 'Wow' },
] as const;

function csvCell(value: string | null) {
  const text = value ?? '';
  const safe = /^[=+@\-]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

export default function Questions() {
  const { session } = useAuth();
  const [question, setQuestion] = useState<DailyQuestion | null>(null);
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [members, setMembers] = useState<SpaceRow[]>([]);
  const [answers, setAnswers] = useState<QuestionAnswer[]>([]);
  const answersRef = useRef<QuestionAnswer[]>([]);
  answersRef.current = answers;
  const [comments, setComments] = useState<QuestionComment[]>([]);
  const [reactions, setReactions] = useState<QuestionReaction[]>([]);
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [answerText, setAnswerText] = useState('');
  const [visibility, setVisibility] = useState<AnswerVisibility>('private');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadInteractions = useCallback(async (answerIds: string[]) => {
    if (!supabase || answerIds.length === 0) {
      setComments([]);
      setReactions([]);
      return;
    }
    const [commentResult, reactionResult] = await Promise.all([
      supabase.from('question_answer_comments').select('id,answer_id,author,comment,created_at').in('answer_id', answerIds).order('created_at'),
      supabase.from('question_answer_reactions').select('answer_id,user_id,reaction').in('answer_id', answerIds),
    ]);
    if (commentResult.error || reactionResult.error) {
      setError(commentResult.error?.message ?? reactionResult.error?.message ?? 'Could not load answer interactions.');
      return;
    }
    setComments((commentResult.data ?? []) as QuestionComment[]);
    setReactions((reactionResult.data ?? []) as QuestionReaction[]);
  }, []);

  const loadAnswers = useCallback(async () => {
    if (!supabase || !spaceId || !question) return;

    const { data, error: answersError } = await supabase
      .from('question_answers')
      .select(ANSWER_COLUMNS)
      .eq('space_id', spaceId)
      .eq('question_date', question.question_date)
      .order('updated_at');

    if (answersError) setError(answersError.message);
    else {
      const rows = (data ?? []) as QuestionAnswer[];
      setAnswers(rows);
      void loadInteractions(rows.map((row) => row.id));
      const ownAnswer = rows.find((row) => row.author === session?.user.id);
      if (ownAnswer) {
        setAnswerText(ownAnswer.answer);
        setVisibility(ownAnswer.visibility);
      }
      setError(null);
    }
  }, [spaceId, question, session?.user.id, loadInteractions]);

  useEffect(() => {
    if (!supabase || !session) {
      setError('Sign in to see the daily question.');
      setLoading(false);
      return;
    }

    let active = true;
    const client = supabase;
    async function loadQuestionAndSpace() {
      const [questionResult, spaceResult] = await Promise.all([
        client.rpc('get_today_question'),
        client.rpc('get_my_space'),
      ]);
      if (!active) return;

      if (questionResult.error) setError(questionResult.error.message);
      else {
        const questionRow = Array.isArray(questionResult.data)
          ? questionResult.data[0] as DailyQuestion | undefined
          : undefined;
        if (questionRow) setQuestion(questionRow);
        else setError('No daily question is available yet.');
      }

      if (spaceResult.error) setError(spaceResult.error.message);
      else {
        const rows = (Array.isArray(spaceResult.data) ? spaceResult.data : []) as SpaceRow[];
        if (rows.length === 0) setError('Pair your account before opening daily questions.');
        else {
          setSpaceId(rows[0].space_id);
          setMembers(rows);
        }
      }
      setLoading(false);
    }

    void loadQuestionAndSpace();
    return () => { active = false; };
  }, [session]);

  useEffect(() => {
    if (!supabase || !spaceId || !question) return;

    setLoading(true);
    let active = true;
    const client = supabase;
    const channel = client
      .channel(`question-answers:${spaceId}:${question.question_date}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'question_answers',
        filter: `space_id=eq.${spaceId}`,
      }, () => {
        void loadAnswers();
      })
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'question_answer_comments', filter: `space_id=eq.${spaceId}`,
      }, () => { void loadInteractions(answersRef.current.map((answer) => answer.id)); })
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'question_answer_reactions', filter: `space_id=eq.${spaceId}`,
      }, () => { void loadInteractions(answersRef.current.map((answer) => answer.id)); })
      .subscribe();

    async function refresh() {
      await loadAnswers();
      if (active) setLoading(false);
    }

    void refresh();
    return () => {
      active = false;
      void client.removeChannel(channel);
    };
  }, [spaceId, question, loadAnswers, loadInteractions]);

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !spaceId || !question || !session) return;

    const answer = answerText.trim();
    if (!answer || answer.length > 5000) return;

    setSaving(true);
    setError(null);
    setNotice(null);
    const { error: saveError } = await supabase.rpc('save_question_answer', {
      p_space_id: spaceId,
      p_question_date: question.question_date,
      p_answer: answer,
      p_visibility: visibility,
    });

    if (saveError) setError(saveError.message);
    else {
      setNotice('Your answer is saved.');
      await loadAnswers();
    }
    setSaving(false);
  }

  async function addComment(answer: QuestionAnswer) {
    if (!supabase || !spaceId || !question || !session) return;
    const comment = (commentDrafts[answer.id] ?? '').trim();
    if (!comment) return;
    setSaving(true);
    const { error: commentError } = await supabase.from('question_answer_comments').insert({
      answer_id: answer.id,
      space_id: spaceId,
      question_date: question.question_date,
      answer_author: answer.author,
      author: session.user.id,
      comment,
    });
    if (commentError) setError(commentError.message);
    else {
      setCommentDrafts((current) => ({ ...current, [answer.id]: '' }));
      await loadInteractions(answers.map((item) => item.id));
    }
    setSaving(false);
  }

  async function toggleAnswerReaction(answer: QuestionAnswer, reaction: QuestionReaction['reaction']) {
    if (!supabase) return;
    const { error: reactionError } = await supabase.rpc('toggle_question_answer_reaction', {
      p_answer_id: answer.id,
      p_reaction: reaction,
    });
    if (reactionError) setError(reactionError.message);
    else await loadInteractions(answers.map((item) => item.id));
  }

  async function loadHistory() {
    if (!supabase) return [] as HistoryRow[];
    setHistoryLoading(true);
    const { data, error: historyError } = await supabase.rpc('get_question_history', { p_limit: 2557 });
    if (historyError) setError(historyError.message);
    const rows = historyError ? [] : (data ?? []) as HistoryRow[];
    setHistory(rows);
    setHistoryLoading(false);
    return rows;
  }

  async function exportHistory() {
    const rows = history.length ? history : await loadHistory();
    if (!rows.length) return;
    const csv = [
      ['Date', 'Prompt', 'Category', 'Answer', 'Visibility'].map(csvCell).join(','),
      ...rows.map((row) => [row.question_date, row.prompt, row.category, row.answer, row.visibility].map(csvCell).join(',')),
    ].join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'evermore-question-history.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  function renderAnswerInteractions(answer: QuestionAnswer, label: string) {
    const answerComments = comments.filter((comment) => comment.answer_id === answer.id);
    const answerReactions = reactions.filter((reaction) => reaction.answer_id === answer.id);
    return (
      <div className="question-answer-interactions">
        <div className="question-answer-reactions" role="group" aria-label={`${label} reactions`}>
          {QUESTION_REACTIONS.map((item) => {
            const matching = answerReactions.filter((reaction) => reaction.reaction === item.value);
            const selected = matching.some((reaction) => reaction.user_id === session?.user.id);
            return <button type="button" key={item.value} aria-label={item.label} aria-pressed={selected} className={selected ? 'is-reacted' : ''} onClick={() => void toggleAnswerReaction(answer, item.value)}>{item.icon}{matching.length > 0 && <span>{matching.length}</span>}</button>;
          })}
        </div>
        <ul className="question-comments">
          {answerComments.map((comment) => (
            <li key={comment.id}><strong>{comment.author === session?.user.id ? 'You' : partnerName}</strong><span>{comment.comment}</span></li>
          ))}
        </ul>
        <form className="question-comment-form" onSubmit={(event) => { event.preventDefault(); void addComment(answer); }}>
          <label className="visually-hidden" htmlFor={`question-comment-${answer.id}`}>Reply to {label}</label>
          <input id={`question-comment-${answer.id}`} maxLength={2000} placeholder="Leave a kind reply" value={commentDrafts[answer.id] ?? ''} onChange={(event) => setCommentDrafts((current) => ({ ...current, [answer.id]: event.target.value }))} />
          <button type="submit" disabled={saving || !(commentDrafts[answer.id] ?? '').trim()}>Reply</button>
        </form>
      </div>
    );
  }

  if (loading) return <main role="status">Loading today’s question...</main>;

  const ownAnswer = answers.find((row) => row.author === session?.user.id);
  const partnerAnswer = answers.find((row) => row.author !== session?.user.id);
  const partnerName = members.find((member) => member.member_id !== session?.user.id)?.member_display_name || 'Your partner';

  return (
    <main className="questions-page">
      <section className="questions-panel">
        <header className="questions-header">
          <div>
            <p className="questions-eyebrow">
              Year {question?.progression_year} of 7 · Day {question?.journey_day} of 2,557 · {question?.category}
            </p>
            <h1>Our Little Questions</h1>
            <p className="questions-stage">{question?.depth} · shaped for connection across distance</p>
          </div>
        </header>

        {!spaceId ? (
          <p>Pair your account to begin. <Link to="/pairing">Go to Pairing</Link></p>
        ) : question && (
          <>
            <section className="daily-question" aria-labelledby="daily-prompt">
              <h2 id="daily-prompt">{question.prompt}</h2>
            </section>

            <form className="answer-form" onSubmit={handleSave}>
              <label htmlFor="daily-answer">Your answer</label>
              <textarea
                id="daily-answer"
                maxLength={5000}
                required
                placeholder="Write your answer..."
                value={answerText}
                onChange={(event) => setAnswerText(event.target.value)}
              />
              <div className="answer-form-footer">
                <label htmlFor="answer-visibility">Who can see it?</label>
                <select
                  id="answer-visibility"
                  value={visibility}
                  onChange={(event) => setVisibility(event.target.value as AnswerVisibility)}
                >
                  <option value="private">Private to me</option>
                  <option value="shared">Share immediately</option>
                  <option value="after_both">Reveal after we both answer</option>
                </select>
                <span>{answerText.length}/5000</span>
                <button type="submit" disabled={saving || !answerText.trim()}>
                  {saving ? 'Saving...' : ownAnswer ? 'Update answer' : 'Save answer'}
                </button>
              </div>
            </form>

            <section className="answers-section" aria-live="polite">
              <h2>Answers</h2>
              {ownAnswer && <article className="partner-answer"><h3>Your answer</h3><p>{ownAnswer.answer}</p>{renderAnswerInteractions(ownAnswer, 'your answer')}</article>}
              {partnerAnswer ? (
                <article className="partner-answer">
                  <h3>{partnerName}</h3>
                  <p>{partnerAnswer.answer}</p>
                  {partnerAnswer.visibility === 'after_both' && <small>Revealed after both answered</small>}
                  {renderAnswerInteractions(partnerAnswer, `${partnerName}'s answer`)}
                </article>
              ) : (
                <p className="answer-hidden">Your partner’s answer isn’t visible yet.</p>
              )}
            </section>

            <section className="question-history-section">
              <header><h2>Question history</h2><div><button type="button" onClick={() => { const next = !historyOpen; setHistoryOpen(next); if (next && !history.length) void loadHistory(); }}>{historyOpen ? 'Hide history' : 'Open history'}</button><button type="button" disabled={!history.length} onClick={() => void exportHistory()}>Export CSV</button></div></header>
              {historyLoading && <p role="status">Loading history...</p>}
              {historyOpen && history.map((row, index) => <article className="question-history-item" key={`${row.question_date}-${row.answer_id ?? index}`}><p>{row.question_date} · {row.category}</p><h3>{row.prompt}</h3>{row.answer && <p><strong>{row.author === session?.user.id ? 'You' : partnerName}:</strong> {row.answer}</p>}</article>)}
              {historyOpen && !historyLoading && history.length === 0 && <p>No answered questions yet.</p>}
            </section>
          </>
        )}

        {error && <p className="questions-feedback" role="alert">{error}</p>}
        {notice && <p className="questions-feedback" role="status">{notice}</p>}
      </section>
    </main>
  );
}
