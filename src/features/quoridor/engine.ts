/** Pure Quoridor rules shared by UI previews and future server commands. */
export type Position = readonly [number, number];
export type Wall = { r: number; c: number; vertical: boolean };
export type QuoridorAction = { type: 'move'; to: Position } | { type: 'wall'; wall: Wall } | { type: 'skip' };
export type QuoridorGame = {
  playerCount: 2 | 4;
  positions: Position[];
  walls: Wall[];
  wallsRemaining: number[];
  currentPlayer: number;
  winner: number | null;
  turnNumber: number;
};

const DIRECTIONS: Position[] = [[1,0],[-1,0],[0,1],[0,-1]];
const within = ([r,c]: Position) => r >= 0 && r < 9 && c >= 0 && c < 9;
const equal = (a: Position,b: Position) => a[0] === b[0] && a[1] === b[1];
const id = ([r,c]: Position) => `${r},${c}`;

export function createQuoridorGame(playerCount: 2 | 4): QuoridorGame {
  return {
    playerCount,
    positions: playerCount === 2 ? [[8,4],[0,4]] : [[8,4],[4,0],[0,4],[4,8]],
    walls: [], wallsRemaining: Array(playerCount).fill(playerCount === 2 ? 10 : 5),
    currentPlayer: 0, winner: null, turnNumber: 1,
  };
}

export function isGoal(game: QuoridorGame, player: number, point = game.positions[player]): boolean {
  if (game.playerCount === 2) return player === 0 ? point[0] === 0 : point[0] === 8;
  return [point[0] === 0,point[1] === 8,point[0] === 8,point[1] === 0][player];
}

export function isEdgeBlocked(walls: readonly Wall[], a: Position, b: Position): boolean {
  if (!within(a) || !within(b) || Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) !== 1) return true;
  for (const w of walls) {
    if (w.vertical && a[0] === b[0] && Math.min(a[1],b[1]) === w.c && (a[0] === w.r || a[0] === w.r+1)) return true;
    if (!w.vertical && a[1] === b[1] && Math.min(a[0],b[0]) === w.r && (a[1] === w.c || a[1] === w.c+1)) return true;
  }
  return false;
}

export function legalPawnMoves(game: QuoridorGame, player = game.currentPlayer): Position[] {
  const source = game.positions[player];
  const occupied = game.positions.filter((_,i) => i !== player);
  const result = new Map<string,Position>();
  for (const [dr,dc] of DIRECTIONS) {
    const adjacent: Position = [source[0]+dr,source[1]+dc];
    if (isEdgeBlocked(game.walls,source,adjacent)) continue;
    if (!occupied.some(p => equal(p,adjacent))) { result.set(id(adjacent),adjacent); continue; }
    const beyond: Position = [adjacent[0]+dr,adjacent[1]+dc];
    if (!isEdgeBlocked(game.walls,adjacent,beyond)) {
      if (!occupied.some(p => equal(p,beyond))) result.set(id(beyond),beyond);
      continue; // Never jump over multiple pawns or turn diagonally around another pawn.
    }
    const sides: Position[] = dr !== 0 ? [[0,1],[0,-1]] : [[1,0],[-1,0]];
    for (const [sr,sc] of sides) {
      const side: Position = [adjacent[0]+sr,adjacent[1]+sc];
      if (!isEdgeBlocked(game.walls,adjacent,side) && !occupied.some(p => equal(p,side))) result.set(id(side),side);
    }
  }
  return [...result.values()];
}

export function hasGoalPath(game: QuoridorGame, player: number, walls: readonly Wall[] = game.walls): boolean {
  const queue: Position[] = [game.positions[player]];
  const visited = new Set([id(queue[0])]);
  for (let i=0;i<queue.length;i++) {
    const current = queue[i];
    if (isGoal(game,player,current)) return true;
    for (const [dr,dc] of DIRECTIONS) {
      const next: Position = [current[0]+dr,current[1]+dc];
      if (!visited.has(id(next)) && !isEdgeBlocked(walls,current,next)) {visited.add(id(next));queue.push(next);}
    }
  }
  return false;
}

export function canPlaceWall(game: QuoridorGame, proposed: Wall): boolean {
  if (game.winner !== null || game.wallsRemaining[game.currentPlayer] <= 0) return false;
  if (!Number.isInteger(proposed.r) || !Number.isInteger(proposed.c) || typeof proposed.vertical !== 'boolean') return false;
  if (proposed.r < 0 || proposed.r > 7 || proposed.c < 0 || proposed.c > 7) return false;
  for (const wall of game.walls) {
    if (wall.r === proposed.r && wall.c === proposed.c) return false;
    if (wall.vertical === proposed.vertical && (wall.vertical
      ? wall.c === proposed.c && Math.abs(wall.r-proposed.r) <= 1
      : wall.r === proposed.r && Math.abs(wall.c-proposed.c) <= 1)) return false;
  }
  const walls = [...game.walls,proposed];
  return game.positions.every((_,player) => hasGoalPath(game,player,walls));
}

export function applyQuoridorAction(game: QuoridorGame, action: QuoridorAction): QuoridorGame {
  if (game.winner !== null) throw new Error('GAME_FINISHED');
  const next: QuoridorGame = {
    ...game, positions: game.positions.map(p => [...p] as Position),
    walls: game.walls.map(w => ({...w})), wallsRemaining: [...game.wallsRemaining], turnNumber: game.turnNumber+1,
  };
  if (action.type === 'move') {
    if (!legalPawnMoves(game).some(p => equal(p,action.to))) throw new Error('INVALID_MOVE');
    next.positions[game.currentPlayer] = [...action.to];
    if (isGoal(next,game.currentPlayer)) next.winner = game.currentPlayer;
  } else if (action.type === 'wall') {
    if (!canPlaceWall(game,action.wall)) throw new Error('INVALID_WALL');
    next.walls.push({...action.wall});next.wallsRemaining[game.currentPlayer]--;
  }
  if (next.winner === null) next.currentPlayer = (game.currentPlayer+1)%game.playerCount;
  return next;
}
