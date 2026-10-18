import type { BetterSidebarService } from 'dsh-better-sidebar/client/service';

export interface FindingNavigation { findingId:string; revision:number }
let navigation:FindingNavigation={findingId:'',revision:0};
const listeners=new Set<()=>void>();
export const readFindingNavigation=()=>navigation;
export function subscribeFindingNavigation(listener:()=>void):()=>void {listeners.add(listener);return()=>{listeners.delete(listener);};}

/** DSH may not have an active session when plugins load. Keep the landing pending
 * until BetterSidebar announces a session, then let its public open API reveal it. */
export function installFindingDeepLink(sidebar:Pick<BetterSidebarService,'openTab'|'getSnapshot'|'subscribeState'>):()=>void {
  if(typeof window==='undefined'||!window.location)return()=>{};
  let pending=false;
  const open=()=>{
    if(!pending||!sidebar.getSnapshot().sessionId)return;
    pending=false;
    sidebar.openTab({type:'dsh-redteam:findings',target:'right',reveal:true,meta:{findingId:navigation.findingId}});
  };
  const navigate=()=>{
    const findingId=new URLSearchParams(window.location.search).get('redteamFinding')?.trim() ?? '';
    navigation={findingId,revision:navigation.revision+1};listeners.forEach(listener=>listener());
    pending=Boolean(findingId);open();
  };
  // No query means no sidebar interaction, including on non-browser test hosts.
  const hasTarget=()=>new URLSearchParams(window.location.search).has('redteamFinding');
  let unsubscribe:(()=>void)|undefined;
  const follow=()=>{if(hasTarget()&&!unsubscribe)unsubscribe=sidebar.subscribeState(open);navigate();};
  window.addEventListener('popstate',follow);if(hasTarget())follow();
  return()=>{window.removeEventListener('popstate',follow);unsubscribe?.();};
}
