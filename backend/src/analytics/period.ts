import {COMPETITION_PERIOD,type TimeRange} from '@leadboard/contracts';

export function rangeBounds(range:TimeRange,now:Date):{from:string|null;to:string} {
  if(range==='competition')return {
    from:COMPETITION_PERIOD.startsAt,
    to:new Date(Math.min(now.getTime(),Date.parse(COMPETITION_PERIOD.endsAtExclusive))).toISOString(),
  };
  const to=now.toISOString();
  if(range==='all')return {from:null,to};
  const days=range==='7d'?7:range==='30d'?30:90;
  return {from:new Date(now.getTime()-days*86400000).toISOString(),to};
}
