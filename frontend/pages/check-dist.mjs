import {fileURLToPath} from 'node:url'
import {assertArtifact} from './build-tools.mjs'
const stats=assertArtifact(fileURLToPath(new URL('../dist',import.meta.url)),process.env.VITE_PAGES_BASE||'/mecoffe-scene/')
console.log(JSON.stringify(stats,null,2))
