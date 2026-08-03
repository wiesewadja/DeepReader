#!/usr/bin/env node
/**
 * Build a standalone eval entry point that exports searchBookV2
 * for use in eval scripts outside Obsidian.
 */
import * as esbuild from "esbuild";
import builtins from "builtin-modules";

const context = await esbuild.context({
  entryPoints: ["src/eval/search-entry.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/*",
    "@lezer/*",
    ...builtins,
    "node:fs",
    "node:fs/promises",
    "node:path",
    "node:crypto",
    "node:os",
    "node:util",
    "node:stream",
    "node:events",
    "./pageindex/vault/*",
    "./pageindex/parsers/pdf-to-markdown",
  ],
  format: "cjs",
  target: "es2020",
  loader: { ".jpg": "dataurl" },
  logLevel: "info",
  sourcemap: false,
  treeShaking: true,
  minify: false,
  keepNames: true,
  outfile: "scripts/eval/search-bundle.cjs",
  banner: {
    js: `// Auto-generated eval entry — do not edit
// Mock obsidian module for Node.js
(function(){
  if(typeof require==='undefined')return;
  const M=require('module');
  const orig=M._resolveFilename;
  M._resolveFilename=function(r,p,i,o){
    if(r==='obsidian')return __filename+':obsidian';
    return orig.call(this,r,p,i,o);
  };
  const or=M.prototype.require;
  M.prototype.require=function(id){
    if(id==='obsidian'||(typeof id==='string'&&id.includes(':obsidian'))){var _Setting=function(){function S(){this.controlEl={querySelector:function(){return null},empty:function(){}}}S.prototype.setName=function(){return this};S.prototype.setDesc=function(){return this};S.prototype.addText=function(){return this};S.prototype.addToggle=function(){return this};S.prototype.addDropdown=function(){return this};S.prototype.addButton=function(){return this};S.prototype.addSlider=function(){return this};S.prototype.addExtraButton=function(){return this};return S;}();return{Plugin:class{constructor(){}async onload(){}async onunload(){}addCommand(){}addRibbonIcon(){}addStatusBarItem(){}addView(){}registerEvent(){}registerInterval(){}addSettingTab(){}async saveSettings(){}},PluginSettingTab:class{constructor(){}display(){}hide(){}},Setting:_Setting,Notice:class{constructor(){}},Modal:class{constructor(){}open(){}close(){}onOpen(){}onClose(){}},TFile:class{constructor(){}},TFolder:class{constructor(){}},Vault:class{},Workspace:class{},MarkdownView:class{},Editor:class{},MarkdownRenderer:class{},MarkdownPostProcessorContext:class{},Menu:class{},MenuItem:class{},Component:class{constructor(){}onload(){}onunload(){}addChild(){}removeChild(){}load(){}unload(){}loadChildren(){}},Events:class{constructor(){}on(){}off(){}offref(){}trigger(){}},requestUrl:async function(opts){var u=opts.url,m=(opts.method||'GET').toUpperCase(),h=Object.assign({},opts.headers||{});if(opts.contentType)h['Content-Type']=opts.contentType;var b=opts.body;var fo={method:m,headers:h};if(b&&m!=='GET'&&m!=='HEAD'){fo.body=typeof b==='string'?b:JSON.stringify(b);}var r=await fetch(u,fo);var txt=await r.text();var js=undefined;try{js=JSON.parse(txt)}catch(e){}return{status:r.status,headers:Object.fromEntries(r.headers.entries()),text:txt,json:js,arrayBuffer:new TextEncoder().encode(txt).buffer}},setIcon:()=>{},normalizePath:p=>p,Platform:{isMobile:false,isDesktop:true,isDesktopApp:true,isMobileApp:false},MarkdownPreviewView:class{},WorkspaceLeaf:class{},FileView:class{},ItemView:class{constructor(){}getViewType(){return''}getDisplayText(){return''}getIcon(){return'document'}async onOpen(){}async onClose(){}},MarkdownEditView:class{},FuzzySuggestModal:class{constructor(){}open(){}close(){}}};}
    return or.call(this,id);
  };
})();`,
  },
});

await context.rebuild();
console.log("✓ Eval entry built: scripts/eval/search-bundle.cjs");
process.exit(0);
