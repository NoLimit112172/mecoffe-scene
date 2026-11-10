// One shared explanation table. This never retries, selects a fallback or edits inputs.
import messages from '../../../adapter/scene_service/issue_messages.json' with {type:'json'}
export {messages as sceneIssueMessages}
export function describeSceneIssue(error){
  const code=typeof error?.code==='string'&&error.code?error.code:'INVALID_INPUT'
  return {code,...structuredClone(messages[code]||messages.INVALID_INPUT),
    details:typeof error?.message==='string'?error.message:String(error??'')}
}
