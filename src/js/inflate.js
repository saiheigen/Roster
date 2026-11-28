
// 解壓縮（RFC 1951 raw deflate），不依賴瀏覽器的 DecompressionStream，舊版 iPhone 也能打開班表連結。
// 依 zlib 附的 puff.c 寫法：一次讀一個位元、以標準 Huffman 碼表解碼。
const RosterInflate=(()=>{
 'use strict';
 const LBASE=[3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258];
 const LEXT=[0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
 const DBASE=[1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577];
 const DEXT=[0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];
 const ORDER=[16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15];
 function table(lengths){
  const count=new Uint16Array(16),offs=new Uint16Array(16),symbol=new Uint16Array(lengths.length);
  for(const l of lengths)count[l]++;
  count[0]=0;for(let l=1;l<15;l++)offs[l+1]=offs[l]+count[l];
  lengths.forEach((l,s)=>{if(l)symbol[offs[l]++]=s;});
  return {count,symbol};
 }
 let fixed=null;
 function fixedTables(){
  if(!fixed){const l=new Array(288);for(let i=0;i<288;i++)l[i]=i<144?8:i<256?9:i<280?7:8;fixed=[table(l),table(new Array(30).fill(5))];}
  return fixed;
 }
 function inflate(src){
  let pos=0,buf=0,cnt=0;const out=[];
  const bits=n=>{let v=0;for(let i=0;i<n;i++){if(!cnt){if(pos>=src.length)throw Error('資料不完整');buf=src[pos++];cnt=8;}v|=(buf&1)<<i;buf>>=1;cnt--;}return v;};
  const decode=h=>{
   let code=0,first=0,index=0;
   for(let len=1;len<=15;len++){code|=bits(1);const c=h.count[len];if(code-c<first)return h.symbol[index+code-first];index+=c;first+=c;first<<=1;code<<=1;}
   throw Error('資料損壞');
  };
  let last;
  do{
   last=bits(1);const type=bits(2);
   if(type===0){
    cnt=0;if(pos+4>src.length)throw Error('資料不完整');
    const len=src[pos]|src[pos+1]<<8;pos+=4;if(pos+len>src.length)throw Error('資料不完整');
    for(let i=0;i<len;i++)out.push(src[pos++]);
   }else if(type===1||type===2){
    let lit,dist;
    if(type===1)[lit,dist]=fixedTables();
    else{
     const hlit=bits(5)+257,hdist=bits(5)+1,hclen=bits(4)+4,cl=new Array(19).fill(0);
     for(let i=0;i<hclen;i++)cl[ORDER[i]]=bits(3);
     const ch=table(cl),lengths=[];
     while(lengths.length<hlit+hdist){
      const sym=decode(ch);
      if(sym<16)lengths.push(sym);
      else if(sym===16){if(!lengths.length)throw Error('資料損壞');const prev=lengths[lengths.length-1];for(let r=3+bits(2);r--;)lengths.push(prev);}
      else if(sym===17){for(let r=3+bits(3);r--;)lengths.push(0);}
      else{for(let r=11+bits(7);r--;)lengths.push(0);}
     }
     lit=table(lengths.slice(0,hlit));dist=table(lengths.slice(hlit,hlit+hdist));
    }
    for(;;){
     const sym=decode(lit);
     if(sym<256)out.push(sym);
     else if(sym===256)break;
     else{
      const s=sym-257;if(s>=29)throw Error('資料損壞');
      const len=LBASE[s]+bits(LEXT[s]),ds=decode(dist);if(ds>=30)throw Error('資料損壞');
      const d=DBASE[ds]+bits(DEXT[ds]);if(d>out.length)throw Error('資料損壞');
      for(let i=0;i<len;i++)out.push(out[out.length-d]);
     }
    }
   }else throw Error('資料損壞');
  }while(!last);
  return Uint8Array.from(out);
 }
 return {inflate};
})();
