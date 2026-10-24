import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../components/AuthProvider';
import { supabase } from '../lib/supabase';

type Point = [number, number];
type StrokeOperation = { type: 'stroke' | 'erase'; points: Point[]; color: string; width: number };
type ClearOperation = { type: 'clear' };
type UndoOperation = { type: 'undo'; target: string };
type DrawOperation = StrokeOperation | ClearOperation;
type CanvasOperation = DrawOperation | UndoOperation;
type StoredOperation = {
  id: string;
  board_id: string;
  author: string;
  op: CanvasOperation;
  created_at: string;
};
type PendingOperation = { id: string; op: DrawOperation };
type ActiveStroke = StrokeOperation;

const MAX_LOADED_OPERATIONS = 1000;

function readOperation(value: unknown): CanvasOperation | null {
  if (!value || typeof value !== 'object') return null;
  const operation = value as Record<string, unknown>;
  if (operation.type === 'clear') return { type: 'clear' };
  if (operation.type === 'undo') return typeof operation.target === 'string' ? { type: 'undo', target: operation.target } : null;
  if (!['stroke', 'erase'].includes(String(operation.type)) || !Array.isArray(operation.points)) return null;
  if (typeof operation.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(operation.color)) return null;
  if (typeof operation.width !== 'number' || operation.width < 0.5 || operation.width > 64) return null;

  const points = operation.points.filter((point): point is number[] =>
    Array.isArray(point)
    && point.length === 2
    && point.every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate)),
  ).map((point) => [Math.max(0, Math.min(1, point[0])), Math.max(0, Math.min(1, point[1]))] as Point);

  if (points.length < 2) return null;
  return { type: operation.type as StrokeOperation['type'], points, color: operation.color, width: operation.width };
}

function orderOperations(items: StoredOperation[]) {
  return [...items].sort((left, right) =>
    left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id),
  );
}

function findUndoTarget(items: StoredOperation[], userId: string | undefined) {
  const undone = new Set(items.flatMap((item) => item.op.type === 'undo' ? [item.op.target] : []));
  return [...items].reverse().find((item) => item.author === userId && item.op.type !== 'undo' && !undone.has(item.id));
}

function drawStroke(context: CanvasRenderingContext2D, stroke: StrokeOperation, width: number, height: number, pending = false) {
  context.save();
  context.strokeStyle = stroke.color;
  context.lineWidth = stroke.width;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.globalCompositeOperation = stroke.type === 'erase' ? 'destination-out' : 'source-over';
  context.globalAlpha = pending ? 0.55 : 1;
  if (pending) context.setLineDash([5, 4]);
  context.beginPath();
  context.moveTo(stroke.points[0][0] * width, stroke.points[0][1] * height);
  for (const point of stroke.points.slice(1)) context.lineTo(point[0] * width, point[1] * height);
  context.stroke();
  context.restore();
}

export default function Whiteboard() {
  const { session } = useAuth();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const activePointer = useRef<number | null>(null);
  const [boardId, setBoardId] = useState<string | null>(null);
  const [spaceName, setSpaceName] = useState('Our Whiteboard');
  const [operations, setOperations] = useState<StoredOperation[]>([]);
  const [pending, setPending] = useState<PendingOperation[]>([]);
  const [activeStroke, setActiveStroke] = useState<ActiveStroke | null>(null);
  const [color, setColor] = useState('#773f91');
  const [brushSize, setBrushSize] = useState(5);
  const [tool, setTool] = useState<'pen' | 'eraser'>('pen');
  const [connection, setConnection] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase || !session) {
      setError('Sign in to open the whiteboard.');
      setLoading(false);
      return;
    }

    let active = true;
    const client = supabase;
    async function loadBoard() {
      const { data, error: boardError } = await client.rpc('get_or_create_shared_whiteboard');
      if (!active) return;
      if (boardError) {
        setError(boardError.message);
        setLoading(false);
        return;
      }

      const row = Array.isArray(data) ? data[0] as { board_id: string; title: string } | undefined : undefined;
      if (!row) {
        setError('No shared board is available yet. Pair your account first.');
        setLoading(false);
        return;
      }

      setBoardId(row.board_id);
      setSpaceName(row.title || 'Our Whiteboard');
    }

    void loadBoard();
    return () => { active = false; };
  }, [session]);

  useEffect(() => {
    if (!supabase || !boardId) return;

    let active = true;
    const client = supabase;
    setLoading(true);
    const channel = client
      .channel(`whiteboard:${boardId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'whiteboard_operations',
        filter: `board_id=eq.${boardId}`,
      }, (payload) => {
        const row = payload.new as Omit<StoredOperation, 'op'> & { op: unknown };
        const op = readOperation(row.op);
        if (!row.id || !op) return;
        setOperations((current) => current.some((item) => item.id === row.id)
          ? current
          : orderOperations([...current, { ...row, op } as StoredOperation]));
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') setConnection('connected');
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') setConnection('disconnected');
        else setConnection('connecting');
      });

    async function loadOperations() {
      const { data, error: loadError } = await client
        .from('whiteboard_operations')
        .select('id,board_id,author,op,created_at')
        .eq('board_id', boardId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(MAX_LOADED_OPERATIONS);

      if (!active) return;
      if (loadError) {
        setError(loadError.message);
      } else {
        const rows = (data ?? []).flatMap((row) => {
          const op = readOperation(row.op);
          return op ? [{ ...row, op } as StoredOperation] : [];
        }).reverse();
        setOperations((current) => orderOperations([...rows, ...current.filter((item) => !rows.some((row) => row.id === item.id))]));
        setError(null);
      }
      setLoading(false);
    }

    void loadOperations();
    return () => {
      active = false;
      void client.removeChannel(channel);
    };
  }, [boardId]);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const bounds = canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;

    const scale = window.devicePixelRatio || 1;
    canvas.width = Math.round(bounds.width * scale);
    canvas.height = Math.round(bounds.height * scale);
    const context = canvas.getContext('2d');
    if (!context) return;
    context.setTransform(scale, 0, 0, scale, 0, 0);
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, bounds.width, bounds.height);

    let visible: StoredOperation[] = [];
    const undone = new Set(operations.flatMap((item) => item.op.type === 'undo' ? [item.op.target] : []));
    for (const item of operations) {
      if (item.op.type === 'undo' || undone.has(item.id)) continue;
      if (item.op.type === 'clear') visible = [];
      else visible.push(item);
    }
    for (const item of visible) {
      if (item.op.type === 'stroke' || item.op.type === 'erase') drawStroke(context, item.op, bounds.width, bounds.height);
    }
    for (const item of pending) {
      if (item.op.type === 'clear') {
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, bounds.width, bounds.height);
      } else drawStroke(context, item.op, bounds.width, bounds.height, true);
    }
    if (activeStroke) drawStroke(context, activeStroke, bounds.width, bounds.height);
  }, [operations, pending, activeStroke]);

  useEffect(() => {
    redraw();
    const observer = new ResizeObserver(redraw);
    if (canvasRef.current) observer.observe(canvasRef.current);
    return () => observer.disconnect();
  }, [redraw]);

  async function persistOperation(operation: DrawOperation) {
    if (!supabase || !boardId || !session) return;

    setSaving(true);
    setError(null);
    setNotice(null);
    const { data, error: saveError } = await supabase
      .from('whiteboard_operations')
      .insert({ board_id: boardId, author: session.user.id, op: operation })
      .select('id,board_id,author,op,created_at')
      .single();

    if (saveError) {
      setPending((current) => [...current, { id: crypto.randomUUID(), op: operation }]);
      setError(`Could not save that operation. It remains on this device; retry when connected. ${saveError.message}`);
    } else {
      const stored = data as Omit<StoredOperation, 'op'> & { op: unknown };
      const op = readOperation(stored.op);
      if (op) setOperations((current) => current.some((item) => item.id === stored.id)
        ? current
        : orderOperations([...current, { ...stored, op } as StoredOperation]));
      setNotice('Drawing saved.');
    }
    setSaving(false);
  }

  async function retryPending() {
    if (!supabase || !boardId || !session || !pending.length) return;
    const retry = [...pending];
    let failed = false;
    setSaving(true);
    setError(null);
    for (const item of retry) {
      const { data, error: saveError } = await supabase
        .from('whiteboard_operations')
        .insert({ board_id: boardId, author: session.user.id, op: item.op })
        .select('id,board_id,author,op,created_at')
        .single();
      if (saveError) {
        failed = true;
        setError(`Still unable to save. Your drawing remains on this device. ${saveError.message}`);
        break;
      }
      const stored = data as Omit<StoredOperation, 'op'> & { op: unknown };
      const op = readOperation(stored.op);
      if (op) setOperations((current) => current.some((existing) => existing.id === stored.id)
        ? current
        : orderOperations([...current, { ...stored, op } as StoredOperation]));
      setPending((current) => current.filter((pendingItem) => pendingItem.id !== item.id));
    }
    setSaving(false);
    if (!failed) setNotice('Pending drawing saved.');
  }

  function getPoint(event: PointerEvent<HTMLCanvasElement>): Point {
    const bounds = event.currentTarget.getBoundingClientRect();
    return [
      Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
      Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
    ];
  }

  function handlePointerDown(event: PointerEvent<HTMLCanvasElement>) {
    if (connection !== 'connected' || saving || pending.length > 0 || !boardId) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    activePointer.current = event.pointerId;
    const point = getPoint(event);
    setActiveStroke({ type: tool === 'eraser' ? 'erase' : 'stroke', points: [point, point], color, width: brushSize });
  }

  function handlePointerMove(event: PointerEvent<HTMLCanvasElement>) {
    if (activePointer.current !== event.pointerId || !activeStroke) return;
    const point = getPoint(event);
    setActiveStroke({ ...activeStroke, points: [...activeStroke.points, point] });
  }

  function handlePointerUp(event: PointerEvent<HTMLCanvasElement>) {
    if (activePointer.current !== event.pointerId || !activeStroke) return;
    activePointer.current = null;
    const stroke = activeStroke;
    setActiveStroke(null);
    void persistOperation(stroke);
  }

  async function handleClear() {
    if (!window.confirm('Clear the shared whiteboard for both of you? You can undo your clear afterwards.')) return;
    await persistOperation({ type: 'clear' });
  }

  async function handleUndo() {
    if (!supabase || !boardId || !session) return;
    const target = findUndoTarget(operations, session.user.id);
    if (!target) return;

    setSaving(true);
    setError(null);
    setNotice(null);
    const { data, error: undoError } = await supabase
      .from('whiteboard_operations')
      .insert({ board_id: boardId, author: session.user.id, op: { type: 'undo', target: target.id } })
      .select('id,board_id,author,op,created_at')
      .single();

    if (undoError) setError(`Could not undo. ${undoError.message}`);
    else {
      const stored = data as Omit<StoredOperation, 'op'> & { op: unknown };
      const op = readOperation(stored.op);
      if (op) setOperations((current) => current.some((item) => item.id === stored.id)
        ? current
        : orderOperations([...current, { ...stored, op } as StoredOperation]));
      setNotice('Undid your last action.');
    }
    setSaving(false);
  }

  function handleExport() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (!blob) {
        setError('Could not export the whiteboard image.');
        return;
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'evermore-whiteboard.png';
      link.click();
      URL.revokeObjectURL(url);
    }, 'image/png');
  }

  if (loading) return <main role="status">Loading shared whiteboard...</main>;

  return (
    <main className="whiteboard-page">
      <section className="whiteboard-panel" aria-label="Shared whiteboard">
        <header className="whiteboard-header">
          <div>
            <h1>{spaceName}</h1>
            <span className={`whiteboard-connection whiteboard-connection-${connection}`} role="status">
              {connection === 'connected' ? 'Live' : connection === 'connecting' ? 'Connecting...' : 'Reconnecting...'}
            </span>
          </div>
          <div className="whiteboard-tools">
            <div className="whiteboard-tool-toggle" role="group" aria-label="Drawing tool">
              <button type="button" aria-pressed={tool === 'pen'} onClick={() => setTool('pen')}>Pen</button>
              <button type="button" aria-pressed={tool === 'eraser'} onClick={() => setTool('eraser')}>Eraser</button>
            </div>
            <label>Color <input type="color" disabled={tool === 'eraser'} value={color} onChange={(event) => setColor(event.target.value)} /></label>
            <label>Brush <input aria-label="Brush size" type="range" min="1" max="32" value={brushSize} onChange={(event) => setBrushSize(Number(event.target.value))} /></label>
            <button
              type="button"
              title="Undo your last action"
              disabled={saving || pending.length > 0 || connection !== 'connected' || !findUndoTarget(operations, session?.user.id)}
              onClick={() => void handleUndo()}
            >
              Undo
            </button>
            <button type="button" disabled={saving || pending.length > 0 || connection !== 'connected'} onClick={() => void handleClear()}>Clear</button>
            <button type="button" onClick={handleExport}>Export PNG</button>
          </div>
        </header>

        {error && <p className="whiteboard-feedback" role="alert">{error}</p>}
        {notice && <p className="whiteboard-feedback" role="status">{notice}</p>}
        {pending.length > 0 && (
          <div className="whiteboard-pending" role="status">
            {pending.length} unsaved operation{pending.length === 1 ? '' : 's'} on this device. Finish retrying before drawing more.
            <button type="button" disabled={saving || connection !== 'connected'} onClick={() => void retryPending()}>
              Retry save
            </button>
          </div>
        )}

        {!boardId ? (
          <p>Pair your account before opening the whiteboard. <Link to="/pairing">Go to Pairing</Link></p>
        ) : (
          <canvas
            ref={canvasRef}
            className="whiteboard-canvas"
            aria-label="Shared drawing canvas"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          />
        )}
        <p className="whiteboard-note">Strokes save when finished. Pending marks are local until the save succeeds.</p>
      </section>
    </main>
  );
}
