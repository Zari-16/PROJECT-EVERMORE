import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../components/AuthProvider';
import { supabase } from '../lib/supabase';

type DailyQuestion = {
  question_date: string;
  question_id: string;
  prompt: string;
  category: string;
};

type SpaceRow = {
  space_id: string;
  member_id: string;
  member_display_name: string | null;
};

type AnswerVisibility = 'private' | 'shared' | 'after_both';
type QuestionAnswer = {
  author: string;
  answer: string;
  visibility: AnswerVisibility;
  updated_at: string;
};

const ANSWER_COLUMNS = 'author,answer,visibility,updated_at';

export default function Questions() {
  const { session } = useAuth();
  const [question, setQuestion] = useState<DailyQuestion | null>(null);
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [members, setMembers] = useState<SpaceRow[]>([]);
  const [answers, setAnswers] = useState<QuestionAnswer[]>([]);
  const [answerText, setAnswerText] = useState('');
  const [visibility, setVisibility] = useState<AnswerVisibility>('private');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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
      const ownAnswer = rows.find((row) => row.author === session?.user.id);
      if (ownAnswer) {
        setAnswerText(ownAnswer.answer);
        setVisibility(ownAnswer.visibility);
      }
      setError(null);
    }
  }, [spaceId, question, session?.user.id]);

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
  }, [spaceId, question, loadAnswers]);

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !spaceId || !question || !session) return;

    const answer = answerText.trim();
    if (!answer || answer.length > 5000) return;

    setSaving(true);
    setError(null);
    setNotice(null);
    const { error: saveError } = await supabase
      .from('question_answers')
      .upsert({
        space_id: spaceId,
        question_date: question.question_date,
        author: session.user.id,
        answer,
        visibility,
      }, { onConflict: 'space_id,question_date,author' });

    if (saveError) setError(saveError.message);
    else {
      setNotice('Your answer is saved.');
      await loadAnswers();
    }
    setSaving(false);
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
            <p className="questions-eyebrow">{question?.category} · {question?.question_date}</p>
            <h1>Our Little Questions</h1>
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
              {partnerAnswer ? (
                <article className="partner-answer">
                  <h3>{partnerName}</h3>
                  <p>{partnerAnswer.answer}</p>
                  {partnerAnswer.visibility === 'after_both' && <small>Revealed after both answered</small>}
                </article>
              ) : (
                <p className="answer-hidden">Your partner’s answer isn’t visible yet.</p>
              )}
            </section>
          </>
        )}

        {error && <p className="questions-feedback" role="alert">{error}</p>}
        {notice && <p className="questions-feedback" role="status">{notice}</p>}
      </section>
    </main>
  );
}
