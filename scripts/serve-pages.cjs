// Static files and directory indexes only. No SPA/history/404 fallback.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
function servePages({root,prefix='/mecoffe-scene/',port=5187}={}){
  root=path.resolve(root||path.join(__dirname,'../frontend/dist'));
  const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.txt':'text/plain; charset=utf-8','.md':'text/plain; charset=utf-8'};
  const server=http.createServer((req,res)=>{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname===prefix.slice(0,-1)){res.writeHead(301,{Location:prefix+url.search});res.end();return}
    if(!url.pathname.startsWith(prefix)){res.writeHead(404);res.end('Not found');return}
    let relative;try{relative=decodeURIComponent(url.pathname.slice(prefix.length))}catch{res.writeHead(400);res.end();return}
    let target=path.resolve(root,relative);
    if(target!==root&&!target.startsWith(root+path.sep)){res.writeHead(403);res.end();return}
    try{const stat=fs.statSync(target);if(stat.isDirectory()){
      if(!url.pathname.endsWith('/')){url.pathname+='/';res.writeHead(301,{Location:url.pathname+url.search});res.end();return}
      target=path.join(target,'index.html');
    }if(!fs.statSync(target).isFile())throw new Error();}catch{res.writeHead(404);res.end('Not found');return}
    res.writeHead(200,{'Content-Type':types[path.extname(target)]||'application/octet-stream','Cache-Control':'no-cache','Content-Length':fs.statSync(target).size});if(req.method==='HEAD')res.end();else fs.createReadStream(target).pipe(res);
  });
  return new Promise(resolve=>server.listen(port,'127.0.0.1',()=>resolve(server)));
}
if(require.main===module)servePages({port:Number(process.env.PORT||5187)}).then(server=>console.log('Static Pages simulation: http://127.0.0.1:'+server.address().port+'/mecoffe-scene/ (no fallback)'));
module.exports={servePages};
