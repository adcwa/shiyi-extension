(() => {
  class SSEDecoder {
    constructor(){this.decoder=new TextDecoder();this.buffer='';this.event=[];this.done=false;}
    push(chunk,final=false){
      this.buffer+=this.decoder.decode(chunk||new Uint8Array(),{stream:!final});
      const output=[];let at;
      const dispatch=()=>{if(!this.event.length)return;const data=this.event.join('\n');this.event=[];if(data==='[DONE]'){this.done=true;return;}try{const value=JSON.parse(data);const part=value.choices?.[0]?.delta?.content;if(typeof part==='string'&&!this.done)output.push(part);}catch{throw new Error('流式数据不完整，请保留已生成内容后重试。');}};
      while((at=this.buffer.indexOf('\n'))>=0){let line=this.buffer.slice(0,at);this.buffer=this.buffer.slice(at+1);if(line.endsWith('\r'))line=line.slice(0,-1);if(!line)dispatch();else if(line.startsWith('data:'))this.event.push(line.slice(5).replace(/^ /,''));}
      if(final){if(this.buffer.startsWith('data:'))this.event.push(this.buffer.slice(5).replace(/^ /,''));dispatch();this.buffer='';}
      return output;
    }
  }
  async function* demoStream(text,signal){
    const encoder=new TextEncoder();const source=Array.from(text);
    for(let index=0;index<source.length;index+=34){
      await new Promise((resolve,reject)=>{const finish=()=>{signal?.removeEventListener('abort',cancel);resolve();};const timer=setTimeout(finish,85);const cancel=()=>{clearTimeout(timer);reject(new DOMException('Aborted','AbortError'));};if(signal?.aborted)cancel();else signal?.addEventListener('abort',cancel,{once:true});});
      const frame='data: '+JSON.stringify({choices:[{delta:{content:source.slice(index,index+34).join('')}}]})+'\r\n\r\n';
      const bytes=encoder.encode(frame),cut=Math.min(41,bytes.length);yield bytes.slice(0,cut);yield bytes.slice(cut);
    }
    yield encoder.encode('data: [DONE]\n\n');
  }
  globalThis.DianyiStream={SSEDecoder,demoStream};
})();
