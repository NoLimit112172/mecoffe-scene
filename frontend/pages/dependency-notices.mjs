import fs from 'node:fs'
import path from 'node:path'

// Include original notices for the map SDK's installed dependency closure.
// Read package metadata directly: some ESM packages hide package.json exports.
export function mapDependencyNotices(frontendRoot){
  const seen=new Set(),records=[]
  function locate(name,from){
    for(let directory=from;;directory=path.dirname(directory)){
      const candidate=path.join(directory,'node_modules',name)
      if(fs.existsSync(path.join(candidate,'package.json')))return candidate
      if(path.dirname(directory)===directory)throw new Error('Missing map dependency '+name)
    }
  }
  function visit(name,from){
    const folder=locate(name,from),pkg=JSON.parse(fs.readFileSync(path.join(folder,'package.json'),'utf8')),key=pkg.name+'@'+pkg.version
    if(seen.has(key))return
    seen.add(key)
    const notices=fs.readdirSync(folder).filter(file=>/^(?:licen[sc]e(?:\.[a-z]+)?|notice(?:\.[a-z]+)?)$/i.test(file)&&fs.statSync(path.join(folder,file)).isFile())
    let text=notices.sort().map(file=>`--- ${file} ---\n`+fs.readFileSync(path.join(folder,file),'utf8')).join('\n')
    if(!text){
      // A few small MIT packages put the complete license in their README.
      const readme=fs.readdirSync(folder).find(file=>/^readme(?:\.md|\.txt)?$/i.test(file))
      const body=readme?fs.readFileSync(path.join(folder,readme),'utf8'):''
      const start=body.search(/(?:^|\n)#{1,3}\s+licen[sc]e[^\n]*\n/i)
      if(start<0)throw new Error('Missing original license for '+key)
      text=`--- ${readme}: original license section ---\n`+body.slice(start)
    }
    records.push({key,license:pkg.license,source:pkg.repository?.url||pkg.homepage||'',text})
    for(const dependency of Object.keys(pkg.dependencies||{}).sort())visit(dependency,folder)
  }
  visit('maplibre-gl',frontendRoot)
  return records.sort((a,b)=>a.key.localeCompare(b.key)).map(record=>`${record.key}\nDeclared license: ${record.license}\nSource: ${record.source}\n${record.text}`).join('\n\n'+'='.repeat(72)+'\n\n')
}
