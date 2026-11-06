// Parent-owned verification only; never edits Claude's web source/tests.
const fs=require('fs'),path=require('path'),vm=require('vm');
const root=__dirname,lane=path.join(root,'web-owner/web');
const ts=require(path.join(lane,'node_modules/typescript'));
const {expect}=require(path.join(lane,'node_modules/@playwright/test'));
const srcPath=path.join(lane,'test/workspace-files-races.test.ts');
let source=fs.readFileSync(srcPath,'utf8');
// Model real discrete input events: React flushes the first before the next.
source=source.replaceAll('fire(field(m1, "input"), "a.txt");','fire(field(m1, "input"), "a.txt");\n    await w.settle();').replaceAll('fire(field(m2, "input"), "b.txt");','fire(field(m2, "input"), "b.txt");\n    await w.settle();');
source=source.replace('fileURLToPath(import.meta.url)',JSON.stringify(srcPath));
source+=`\nit("R4 residual: old A settling before live replay must not strand live A", async()=>{
 const w=makeWorld();const props={ws:"ws1",cid:"c1",workVersion:7,refreshList:noRefresh};
 const m1=w.mount(w.FileCreator,props);await w.settle();click(button(m1,/New file/));await w.settle();fire(field(m1,"input"),"a.txt");await w.settle();fire(field(m1,"textarea"),"alpha");await w.settle();click(button(m1,/Create file/));await w.settle();
 w.unmount(m1);const m2=w.mount(w.FileCreator,props);await w.settle();click(button(m2,/Retry the same create/));await w.settle();
 w.world.createCalls[0].d.resolve({});await w.settle();
 w.world.createCalls[1].d.resolve({});await w.settle();
 expect(w.world.store.has(CREATE_KEY)).toBe(false);
 expect(maybeButton(m2,/Retry the same create/)).toBeNull();
 expect(maybeButton(m2,/New file/)).not.toBeNull();
});`;
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
const tests=[];const requireShim=s=>s==='vitest'?{expect,describe:(_n,f)=>f(),it:(name,fn)=>tests.push({name,fn})}:s==='typescript'?ts:require(s);
const mod={exports:{}};vm.compileFunction(js,['require','exports','module'],{filename:srcPath})(requireShim,mod.exports,mod);
(async()=>{const results=[];for(const test of tests){try{await test.fn();results.push({name:test.name,pass:true});}catch(e){results.push({name:test.name,pass:false,error:String(e)});}}
 const out=path.join(root,process.env.R34_PARENT_RESULT||'r34-parent-handler-result.json');fs.writeFileSync(out,JSON.stringify({source:process.env.WF_RACES_SRC_ROOT,scope:'actual transpiled handlers/hook; synthetic transport; parent scheduler correction between discrete input events; one extra completion-order case',results},null,2));console.log(JSON.stringify(results,null,2));if(results.some(r=>!r.pass))process.exitCode=1;})();
