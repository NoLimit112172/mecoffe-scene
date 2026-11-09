import {createLiveRunSession,liveApiPath} from './liveRun.js'

// At most one retained private run in this tab. No storage, URL payloads or
// cross-tab messaging. Switching views retains cursor/pause; switching runs
// disposes and releases the previous run's private data.
let retained=null
export function acquireLiveRunSession(options,listener=()=>{}){
  const key=liveApiPath('run',options)
  if(retained?.key!==key){
    retained?.session.stop()
    const listeners=new Set()
    const session=createLiveRunSession({...options,onChange:state=>{for(const notify of listeners)notify(state)}})
    retained={key,session,listeners}
  }
  const entry=retained
  entry.listeners.add(listener);listener(entry.session.snapshot())
  return {session:entry.session,release(){entry.listeners.delete(listener);if(!entry.listeners.size)entry.session.stop()}}
}
export function clearLiveRunSessions(){retained?.session.stop();retained=null}
