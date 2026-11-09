import {describe,it,expect} from 'vitest';
import {COMPETITION_PERIOD} from '@leadboard/contracts';
import {rangeBounds} from '../src/analytics/period.js';
import {scoreEvents,type ScoringEvent} from '../src/analytics/scoring.js';
const after=new Date('2026-12-20T00:00:00.000Z');
const issue=(identifier:string,occurredAt:string):ScoringEvent=>({contributorId:'1',repositoryGithubId:'101',repository:'org/repo',kind:'issue',identifier,occurredAt,mergedAt:null,title:'有效贡献',url:'https://github.com/org/repo/issues/'+identifier,group:'systems'});
const score=(events:ScoringEvent[])=>{const b=rangeBounds('competition',after);return scoreEvents(events,new Set(['101']),b.from,b.to,new Map([['101',100]]))};
describe('fixed Shanghai competition period',()=>{
  it('uses inclusive calendar dates and caps the query at December 16 midnight Shanghai',()=>{
    expect(rangeBounds('competition',after)).toEqual({from:'2026-08-31T16:00:00.000Z',to:'2026-12-15T16:00:00.000Z'});
    expect(COMPETITION_PERIOD.timezone).toBe('Asia/Shanghai');
  });
  it('counts the first and last milliseconds, excludes activity outside either boundary',()=>{
    const data=score([issue('1','2026-08-31T15:59:59.999Z'),issue('2',COMPETITION_PERIOD.startsAt),issue('3','2026-12-15T15:59:59.999Z'),issue('4',COMPETITION_PERIOD.endsAtExclusive)]);
    expect(data.users.get('1')?.score).toBe(10);
    expect(data.decisions.find(d=>d.identifier==='1')?.points).toBe(0);
    expect(data.decisions.find(d=>d.identifier==='4')).toBeUndefined();
  });
  it('separates PR creation and merge points across competition boundaries',()=>{
    const first={...issue('1','2026-08-01T00:00:00.000Z'),kind:'pull_request' as const,mergedAt:'2026-09-10T00:00:00.000Z'};
    const second={...issue('2','2026-09-15T00:00:00.000Z'),kind:'pull_request' as const,mergedAt:'2026-12-16T00:00:00.000Z'};
    expect(score([first,second]).users.get('1')).toMatchObject({score:50,prOpenedScore:20,prMergedScore:30});
  });
  it('uses the current instant during the competition and returns zero before it starts',()=>{
    const now=new Date('2026-11-09T02:00:00.000Z'),b=rangeBounds('competition',now);
    expect(b.to).toBe(now.toISOString());
    const scored=scoreEvents([issue('1','2026-12-01T00:00:00.000Z')],new Set(['101']),b.from,b.to,new Map([['101',100]]));
    expect(scored.decisions).toEqual([]);
    const before=rangeBounds('competition',new Date('2026-08-30T00:00:00.000Z'));
    expect(scoreEvents([issue('1',COMPETITION_PERIOD.startsAt)],new Set(['101']),before.from,before.to).decisions).toEqual([]);
  });
  it('keeps all history and rolling windows separate from the competition',()=>{
    expect(rangeBounds('all',after)).toEqual({from:null,to:after.toISOString()});
    expect(rangeBounds('7d',after).from).toBe('2026-12-13T00:00:00.000Z');
    expect(rangeBounds('30d',after).from).toBe('2026-11-20T00:00:00.000Z');
    expect(rangeBounds('90d',after).from).toBe('2026-09-21T00:00:00.000Z');
  });
});
