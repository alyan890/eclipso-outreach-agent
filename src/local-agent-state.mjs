import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
const key=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export class AgentState{
  constructor(path){
    mkdirSync(dirname(path),{recursive:true});this.db=new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL;PRAGMA synchronous=FULL;PRAGMA busy_timeout=3000;
      CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY,v TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,kind TEXT NOT NULL,payload TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,not_before INTEGER NOT NULL DEFAULT 0,claimed_at TEXT,finished_at TEXT,reason TEXT,result TEXT);
      CREATE TABLE IF NOT EXISTS budget(day TEXT NOT NULL,kind TEXT NOT NULL,n INTEGER NOT NULL,PRIMARY KEY(day,kind));
      CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY,record TEXT NOT NULL,result TEXT,researched_at TEXT);
      CREATE TABLE IF NOT EXISTS native_profiles(id TEXT PRIMARY KEY,payload TEXT NOT NULL,researched_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY,at TEXT NOT NULL,kind TEXT NOT NULL,detail TEXT NOT NULL);`);
  }
  get(k,fallback=null){const r=this.db.prepare('SELECT v FROM meta WHERE k=?').get(k);return r?JSON.parse(r.v):fallback;}
  set(k,v){this.db.prepare('INSERT INTO meta VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k,JSON.stringify(v));}
  event(kind,detail){this.db.prepare('INSERT INTO events(at,kind,detail) VALUES(?,?,?)').run(new Date().toISOString(),kind,JSON.stringify(detail));this.db.exec('DELETE FROM events WHERE seq < (SELECT coalesce(max(seq),0)-1000 FROM events)');}
  transaction(fn){this.db.exec('BEGIN IMMEDIATE');try{const value=fn();this.db.exec('COMMIT');return value;}catch(e){this.db.exec('ROLLBACK');throw e;}}
  lock(pid,{alive=p=>{try{process.kill(p,0);return true;}catch(error){return error.code!=='ESRCH';}}}={}){
    return this.transaction(()=>{const current=this.get('lock');if(current&&alive(current.pid))return null;
      const owner=randomUUID();this.set('lock',{pid,owner,at:new Date().toISOString()});
      // Searches might already have spent a provider credit: never auto-replay.
      this.db.exec("UPDATE jobs SET state='unknown',reason='INTERRUPTED_SEARCH_OUTCOME_UNKNOWN' WHERE state='running' AND kind IN ('search_discovery','search_lookup')");
      // Interrupted read-only public GET jobs can resume, preserving their IDs.
      this.db.exec("UPDATE jobs SET state='pending',reason='RESUMED_INTERRUPTED_READ' WHERE state='running'");
      return owner;});
  }
  heartbeat(owner,pid,phase){if(this.get('lock')?.owner!==owner)throw new Error('RUNNER_LOCK_LOST');this.set('lock',{owner,pid,at:new Date().toISOString(),phase});}
  unlock(owner){if(this.get('lock')?.owner===owner)this.db.prepare('DELETE FROM meta WHERE k=?').run('lock');}
  enqueue(kind,payload,{id=kind+':'+key(payload),notBefore=0}={}){return this.db.prepare('INSERT OR IGNORE INTO jobs(id,kind,payload,not_before) VALUES(?,?,?,?)').run(id,kind,JSON.stringify(payload),notBefore).changes===1;}
  next({preferDiscovery=false}={}){return this.db.prepare("SELECT * FROM jobs WHERE state='pending' AND not_before<=? ORDER BY CASE WHEN ? AND kind='search_discovery' THEN -2 WHEN kind='profile' AND json_extract(payload,'$.discovery_lane')='APPROVED_OFFER_DISCOVERY' THEN -1 ELSE CASE kind WHEN 'profile' THEN 0 WHEN 'search_lookup' THEN 1 WHEN 'search_discovery' THEN 2 ELSE 3 END END,rowid LIMIT 1").get(Date.now(),Number(preferDiscovery))??null;}
  claim(job,{limit=100,lifetime=100000,kind=job.kind,now=new Date()}={}){
    return this.transaction(()=>{const day=now.toISOString().slice(0,10),n=this.db.prepare('SELECT n FROM budget WHERE day=? AND kind=?').get(day,kind)?.n??0;
      const total=this.db.prepare('SELECT sum(n) n FROM budget WHERE kind=?').get(kind)?.n??0;
      if(n>=limit||total>=lifetime)return false;
      const changed=this.db.prepare("UPDATE jobs SET state='running',claimed_at=?,attempts=attempts+1 WHERE id=? AND state='pending'").run(now.toISOString(),job.id).changes;
      if(changed!==1)return false;
      this.db.prepare('INSERT INTO budget VALUES(?,?,1) ON CONFLICT(day,kind) DO UPDATE SET n=n+1').run(day,kind);return true;});
  }
  finish(job,state,result=null,reason=null){this.db.prepare('UPDATE jobs SET state=?,result=?,reason=?,finished_at=? WHERE id=?').run(state,result?JSON.stringify(result):null,reason,new Date().toISOString(),job.id);}
  postpone(job,ms,reason){this.db.prepare("UPDATE jobs SET state='pending',not_before=?,reason=? WHERE id=?").run(Date.now()+ms,reason,job.id);}
  putRecord(record,result=null){
    const existing=this.db.prepare('SELECT record FROM records WHERE id=?').get(record.lead_id);
    const merged={...(existing?JSON.parse(existing.record):{}),...record};
    this.db.prepare('INSERT INTO records VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET record=excluded.record,result=coalesce(excluded.result,records.result),researched_at=coalesce(excluded.researched_at,records.researched_at)').run(record.lead_id,JSON.stringify(merged),result?JSON.stringify(result):null,result?new Date().toISOString():null);
    return !existing;
  }
  record(id){const r=this.db.prepare('SELECT * FROM records WHERE id=?').get(id);return r?{record:JSON.parse(r.record),result:r.result?JSON.parse(r.result):null,researched_at:r.researched_at}:null;}
  records(limit=25){return this.db.prepare('SELECT * FROM records ORDER BY researched_at DESC,rowid DESC LIMIT ?').all(limit).map(r=>({record:JSON.parse(r.record),result:r.result?JSON.parse(r.result):null,researched_at:r.researched_at}));}
  putNative(row){this.db.prepare('INSERT INTO native_profiles VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,researched_at=excluded.researched_at').run(row.id,JSON.stringify(row),row.researchedAt);}
  nativeRecords(limit=500){return this.db.prepare('SELECT payload FROM native_profiles ORDER BY researched_at DESC LIMIT ?').all(limit).map(r=>JSON.parse(r.payload));}
  counts(){return {records:this.db.prepare('SELECT count(*) n FROM records').get().n,jobs:this.db.prepare('SELECT state,count(*) n FROM jobs GROUP BY state').all(),today:this.db.prepare('SELECT kind,n FROM budget WHERE day=?').all(new Date().toISOString().slice(0,10))};}
  close(){this.db.close();}
}
