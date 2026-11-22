// UI/research grouping only. No group is an authorization to send.
export const OPPORTUNITY_COHORTS=[['WEBSITE','Website work'],['BOOKING','Booking research'],['ORDERING','Ordering research'],['CHANGE','Business updates'],['LOOKUP','Website lookup']];
const types={WEBSITE:['WEBSITE_COMPLETION','WEBSITE_NOTICE_REVIEW','CONFLICTING_WEBSITE_NOTICE','NO_WEBSITE_REVIEW'],BOOKING:['PHONE_BOOKING_PROCESS','APPOINTMENT_REQUEST_REVIEW','BOOKING_REVIEW','BOOKING_FLOW_FAILURE'],ORDERING:['PHONE_ORDERING_PROCESS','ORDERING_REVIEW','ORDERING_FLOW_FAILURE'],CHANGE:['BUSINESS_CHANGE']};
export function cohortMatches(row,cohort,now=Date.now()){
 if(cohort==='LOOKUP')return !row.website;
 return (row.opportunities??[]).some(o=>types[cohort]?.includes(o.type)&&typeof o.source==='string'&&o.source.startsWith('https://')&&Number.isFinite(Date.parse(o.observed))&&Date.parse(o.observed)<=now&&now-Date.parse(o.observed)<=72*3600000);
}
