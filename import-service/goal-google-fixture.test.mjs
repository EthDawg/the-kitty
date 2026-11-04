import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {GOAL_HEADERS, goalCells} from './goals-google.mjs';

const fixture=JSON.parse(readFileSync(new URL('./evidence/goal-append-google.json',import.meta.url)));

test('production goal cells match both rows actually appended and recalculated by Google',()=>{
  assert.deepEqual(fixture.goalEnteredRows[0].map(c=>c.stringValue),GOAL_HEADERS);
  fixture.inputGoals.forEach((goal,i)=>{
    assert.deepEqual(goalCells(goal,'au-aud-basic').map(c=>c.userEnteredValue),fixture.goalEnteredRows[i+1]);
    const actual=fixture.grids.goals[i+1];
    assert.equal(actual[0],goal.name);
    assert.equal(actual[1],Number(goal.targetMinor)/100);
    assert.equal(actual[4],1234.56);
    assert.ok(Math.abs(actual[5]-1234.56/actual[1])<1e-12);
    assert.equal(actual[8],'');
    assert.equal(actual[9],'Awaiting three months of history');
  });
  assert.deepEqual(fixture.verification.formulaErrors,[]);
  assert.equal(fixture.verification.firstGoalUnchangedAfterSecondAppend,true);
});

test('native projection reads the Google goal results without inventing savings history',()=>{
  const context={};vm.createContext(context);
  for(const file of ['engine','bridge'])vm.runInContext(readFileSync(new URL(`../ios/Kitty/Resources/${file}.js`,import.meta.url),'utf8'),context);
  const household=context.NativeKitty.project(context.NativeKitty.fromGrids(fixture.grids));
  assert.equal(household.goals.length,2);
  assert.equal(household.transactions.length,0);
  for(const [i,goal]of household.goals.entries()){
    assert.equal(goal.row,i+2);
    assert.equal(goal.target,Number(fixture.inputGoals[i].targetMinor)/100);
    assert.equal(goal.date,fixture.inputGoals[i].targetDate);
    assert.equal(goal.balance,1234.56);
    assert.equal(goal.savedPm,null);
    assert.equal(goal.status,'Awaiting three months of history');
    assert.equal(goal.needPm,fixture.grids.goals[i+1][7]);
  }
});
