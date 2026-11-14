// Executes real registered panel/RuleEdit/IconSet components and application
// adapters. Only React scheduling/context and leaf controls are fixtures: no
// DOM, layout, browser events or pixels. No SDK source extraction/rewrite.
import assert from 'node:assert/strict';
import React from 'react';
export function mountConditionalEditor(Component, props, injector) {
  const instances = new Map(); let tree, dirty = true, active, index, effects = [];
  const internals = React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  const depsChanged = (a,b) => !a || !b || a.length !== b.length || a.some((v,i)=>!Object.is(v,b[i]));
  const state = initial => { const i=index++, hooks=active.hooks; hooks[i] ??= {value:typeof initial==='function'?initial():initial}; return [hooks[i].value,v=>{hooks[i].value=typeof v==='function'?v(hooks[i].value):v;dirty=true;}]; };
  const effect = (fn,deps) => { const i=index++, hooks=active.hooks; if(depsChanged(hooks[i]?.deps,deps)){const old=hooks[i];hooks[i]={deps,cleanup:old?.cleanup};effects.push(()=>{old?.cleanup?.();hooks[i].cleanup=fn();});} };
  const dispatcher = {
    useState:state, useReducer:(fn,initial)=>{const [v,set]=state(initial);return [v,a=>set(v=>fn(v,a))];},
    useRef:initial=>{const i=index++;active.hooks[i]??={current:initial};return active.hooks[i];},
    useMemo:(fn,deps)=>{const i=index++;if(depsChanged(active.hooks[i]?.deps,deps))active.hooks[i]={deps,value:fn()};return active.hooks[i].value;},
    useEffect:effect,useLayoutEffect:effect,useContext:()=>({injector}),
  };
  const expanded = new Set(['ConditionFormattingPanel','RuleEdit','IconSet','IconSetRuleEdit','NativeIconRuleEditor','ConditionalRuleEditor','StartNativeRule','HighlightCellStyleEditor','HighlightCellInput','ConditionalStyleEditor','DataBarStyleEditor','ColorScaleStyleEditor']);
  const walk = (node,path='root',force=false) => {
    if(Array.isArray(node))return node.map((n,i)=>walk(n,`${path}.${i}`));
    if(!node?.props)return node;
    if(node.key!=null)path+=`.key:${node.key}`;
    if(typeof node.type==='function'&&(force||expanded.has(node.type.name))){
      let instance=instances.get(path);if(instance?.type!==node.type){instance?.hooks.forEach(h=>h?.cleanup?.());instance={type:node.type,hooks:[]};instances.set(path,instance);}
      instance.seen=true;active=instance;index=0;
      const previous=internals.H;internals.H=dispatcher;
      let result;try{result=node.type(node.props);}finally{internals.H=previous;}
      return walk(result,`${path}.render`);
    }
    return {...node,props:{...node.props,children:walk(node.props.children,`${path}.children`)}};
  };
  const flush = () => {let n=0;do{assert.ok(n++<20,'React fixture failed to settle');dirty=false;instances.forEach(i=>i.seen=false);tree=walk(React.createElement(Component,props),'root',true);for(const [p,i] of instances)if(!i.seen){i.hooks.forEach(h=>h?.cleanup?.());instances.delete(p);}const pending=effects;effects=[];pending.forEach(f=>f());}while(dirty);};
  const nodes = n => Array.isArray(n)?n.flatMap(nodes):n?.props?[n,...nodes(n.props.children)]:[];
  const text = n => Array.isArray(n)?n.map(text).join(''):n?.props?text(n.props.children):String(n??'');
  const find = predicate => {const node=nodes(tree).find(predicate);assert.ok(node,'editor control missing');return node;};
  flush();
  return {find,text:()=>text(tree),flush,
    change(predicate,value){find(predicate).props.onChange(value);flush();},
    async submit(){const button=find(n=>typeof n.props.onClick==='function'&&/panel.submit$|^Submit$/.test(text(n.props.children)));await button.props.onClick();flush();},
    dispose(){instances.forEach(i=>i.hooks.forEach(h=>h?.cleanup?.()));instances.clear();},
  };
}
