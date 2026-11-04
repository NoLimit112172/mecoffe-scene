import {createRouter,createWebHistory} from 'vue-router'

// Static publication deliberately excludes the upstream backend/admin screens.
export default createRouter({history:createWebHistory(import.meta.env.BASE_URL),routes:[
  {path:'/',redirect:'/mecoffe3d'},
  {path:'/mecoffe',name:'mecoffe',component:()=>import('../views/MeCoffeScene.vue')},
  {path:'/mecoffe-gis',name:'mecoffe-gis',component:()=>import('../views/MeCoffeGis.vue')},
  {path:'/mecoffe3d',name:'mecoffe3d',component:()=>import('../views/MeCoffe3DEntry.vue')},
  {path:'/mecoffe3d/assets',name:'asset-library',component:()=>import('../views/AssetLibrary.vue')},
  {path:'/licenses',name:'licenses',component:()=>import('../views/SourceLicenses.vue')},
  {path:'/:pathMatch(.*)*',redirect:'/mecoffe3d'},
]})
