import {historyState} from './research-quality.mjs';
import {prepareDraftHandoff} from './draft-handoff.mjs';
import {reviewIdentity,validateReviewDraft} from './review-draft.mjs';
export function createLocalDraftWriter({state,history,generate}){
  state.db.exec(`CREATE TABLE IF NOT EXISTS local_drafts(id TEXT PRIMARY KEY,lead_id TEXT NOT NULL,status TEXT NOT NULL,payload TEXT,reason TEXT,started_at TEXT NOT NULL,finished_at TEXT)`);
  // A previous process may have reached the provider: never auto-replay it.
  state.db.exec("UPDATE local_drafts SET status='unknown',reason='DRAFT_PROVIDER_OUTCOME_UNKNOWN' WHERE status='running'");
  return async rows=>{
    for(const row of rows){
      const id=await reviewIdentity(row),stored=state.db.prepare('SELECT * FROM local_drafts WHERE id=?').get(id);
      if(stored){row.review_draft={...(stored.payload?JSON.parse(stored.payload):{id,sending_authorized:false}),status:stored.status,reason:stored.reason};continue;}
      if(row.quality_assessment?.decision!=='QUALIFIED'||!generate)continue;
      let handoff,contact;
      try{const snapshot=await history([row],{fresh:true});contact=historyState(row,snapshot);handoff=await prepareDraftHandoff(row,{observations:row.quality_assessment.observations,contactState:contact});}
      catch{row.review_draft={status:'held',reason:'DRAFT_FRESH_HISTORY_REQUIRED',sending_authorized:false};continue;}
      if(handoff.status!=='draft_request_ready'){row.review_draft={status:'held',reason:handoff.reason,sending_authorized:false};continue;}
      const claim=state.transaction(()=>{
        if(state.db.prepare('SELECT count(*) n FROM local_drafts').get().n>=5)return false;
        return state.db.prepare("INSERT OR IGNORE INTO local_drafts(id,lead_id,status,started_at) VALUES(?,?,'running',?)").run(id,row.lead_id,new Date().toISOString()).changes===1;
      });if(!claim)continue;
      try{
        const result=await generate({record:{lead_id:row.lead_id,business_name:row.business_name,address:row.address,city:row.city,state:row.state,country:row.country,category:row.category,public_email:row.public_email},observations:row.quality_assessment.observations,contact_state:contact});
        if(result.id!==id||result.sending_authorized!==false||!['running','held','draft_needs_review'].includes(result.status))throw new Error('DRAFT_RESPONSE_INVALID');
        if(result.status==='draft_needs_review'){
          if(result.evidence_fingerprint!==handoff.job.id)throw new Error('DRAFT_EVIDENCE_CHANGED');
          validateReviewDraft({response:result.draft},handoff);
        }
        const status=result.status==='running'?'unknown':result.status;
        state.db.prepare('UPDATE local_drafts SET status=?,payload=?,reason=?,finished_at=? WHERE id=?').run(status,JSON.stringify(result),result.reason??null,new Date().toISOString(),id);row.review_draft={...result,status};
      }catch(error){const reason=/^DRAFT_[A-Z_]+$/.test(error.message)?error.message:'DRAFT_PROVIDER_OUTCOME_UNKNOWN';state.db.prepare("UPDATE local_drafts SET status='held',reason=?,finished_at=? WHERE id=?").run(reason,new Date().toISOString(),id);row.review_draft={id,status:'held',reason,sending_authorized:false};}
    }
    return rows;
  };
}
