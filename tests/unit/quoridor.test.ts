import { describe, expect, it } from 'vitest';
import { applyQuoridorAction, canPlaceWall, createQuoridorGame, hasGoalPath, isEdgeBlocked, legalPawnMoves } from '../../src/features/quoridor/engine';

describe('Quoridor rules', () => {
  it('starts 2-player and 4-player games with correct wall supplies and positions', () => {
    const two = createQuoridorGame(2), four = createQuoridorGame(4);
    expect(two.positions).toEqual([[8,4],[0,4]]);
    expect(two.wallsRemaining).toEqual([10,10]);
    expect(four.positions).toEqual([[8,4],[4,0],[0,4],[4,8]]);
    expect(four.wallsRemaining).toEqual([5,5,5,5]);
    expect(legalPawnMoves(two)).toHaveLength(3);
    expect(legalPawnMoves(four)).toHaveLength(3);
  });

  it('accepts only legal pawn moves and changes turn', () => {
    const game = applyQuoridorAction(createQuoridorGame(2),{type:'move',to:[7,4]});
    expect(game.positions[0]).toEqual([7,4]);
    expect(game.currentPlayer).toBe(1);
    expect(() => applyQuoridorAction(game,{type:'move',to:[7,4]})).toThrow('INVALID_MOVE');
  });

  it('blocks both edges of each wall and prevents crossing or overlapping', () => {
    const initial = createQuoridorGame(2);
    const game = applyQuoridorAction(initial,{type:'wall',wall:{r:5,c:4,vertical:false}});
    expect(isEdgeBlocked(game.walls,[5,4],[6,4])).toBe(true);
    expect(isEdgeBlocked(game.walls,[5,5],[6,5])).toBe(true);
    expect(canPlaceWall(game,{r:5,c:4,vertical:true})).toBe(false);
    expect(canPlaceWall(game,{r:5,c:5,vertical:false})).toBe(false);
    expect(game.wallsRemaining).toEqual([9,10]);
  });

  it('never permits a wall that seals a pawn away from its goal', () => {
    const game = createQuoridorGame(2);
    game.positions[0] = [8,0];
    game.walls.push({r:7,c:0,vertical:false});
    expect(hasGoalPath(game,0)).toBe(true);
    expect(canPlaceWall(game,{r:7,c:0,vertical:true})).toBe(false);
  });

  it('permits straight jumps and diagonal movement only when the straight jump is blocked', () => {
    const game = createQuoridorGame(2);
    game.positions = [[4,4],[3,4]];
    expect(legalPawnMoves(game)).toContainEqual([2,4]);
    game.walls.push({r:2,c:4,vertical:false});
    expect(legalPawnMoves(game)).toContainEqual([3,3]);
    expect(legalPawnMoves(game)).toContainEqual([3,5]);
    expect(legalPawnMoves(game)).not.toContainEqual([2,4]);
  });

  it('recognizes 2-player and 4-player goals and locks the finished game', () => {
    const two = createQuoridorGame(2);
    two.positions = [[1,4],[0,3]];
    const finished = applyQuoridorAction(two,{type:'move',to:[0,4]});
    expect(finished.winner).toBe(0);
    expect(() => applyQuoridorAction(finished,{type:'skip'})).toThrow('GAME_FINISHED');
    const four = createQuoridorGame(4);
    four.currentPlayer = 1;
    four.positions[1] = [4,7];
    four.positions[3] = [3,8];
    expect(applyQuoridorAction(four,{type:'move',to:[4,8]}).winner).toBe(1);
  });

  it('supports a skipped turn without changing pawns or walls', () => {
    const game = applyQuoridorAction(createQuoridorGame(4),{type:'skip'});
    expect(game.currentPlayer).toBe(1);
    expect(game.positions[0]).toEqual([8,4]);
    expect(game.walls).toEqual([]);
  });
});
