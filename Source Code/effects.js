'use strict';
/* ==========================================================
   TopaZ Editing Pro 26.1 — effects library
   Video effects (GPU shaders), audio effects, transitions, presets
   Numeric/select/check params are mapped to u_p[] in declaration order,
   colour params to u_c0, u_c1, u_c2.
   ========================================================== */
(() => {
const n = (k, nm, min, max, def, extra) => Object.assign({ k, n: nm, min, max, def }, extra || {});
const col = (k, nm, def) => ({ k, n: nm, type: 'color', def });
const sel = (k, nm, options, def = 0) => ({ k, n: nm, type: 'select', options, def });
const chk = (k, nm, def = false) => ({ k, n: nm, type: 'check', def });
const ang = (k, nm, def = 0) => ({ k, n: nm, min: -360, max: 360, def, unit: '°' });
const cx = (def = 50) => n('cx', 'Środek X', 0, 100, def, { unit: '%' });
const cy = (def = 50) => n('cy', 'Środek Y', 0, 100, def, { unit: '%' });

/* ---------- shader bodies ---------- */
const SH = TZ.SHADERS = {
  copy: `o = C;`,
  blur1d: `float r=max(P(0),0.0); if(r<0.5){o=C;return;} vec2 d=vec2(P(1),P(2))*px; float st=max(1.0,r/24.0); float sg=r*0.5; vec4 acc=vec4(0.0); float ws=0.0;
    for(int i=-24;i<=24;i++){ float x=float(i)*st; if(abs(x)>r) continue; float w=exp(-x*x/(2.0*sg*sg)); acc+=T(uv+d*x)*w; ws+=w; } o=acc/ws;`,
  chblur1d: `vec2 d=vec2(P(3),P(4))*px; vec3 sg=max(vec3(P(0),P(1),P(2))*0.5,vec3(0.3)); float rm=max(max(P(0),P(1)),max(P(2),0.5)); float st=max(1.0,rm/24.0);
    vec3 acc=vec3(0.0); vec3 ws=vec3(0.0); float aa=0.0, aw=0.0;
    for(int i=-24;i<=24;i++){ float x=float(i)*st; if(abs(x)>rm) continue; vec4 s=T(uv+d*x); vec3 w=exp(-x*x/(2.0*sg*sg)); acc+=s.rgb*w; ws+=w; aa+=s.a*w.g; aw+=w.g; }
    o=vec4(acc/ws, aa/aw);`,
  camblur: `float r=P(0)*u_k; if(r<0.5){o=C;return;} vec4 acc=vec4(0.0); for(int i=0;i<64;i++){ float fi=float(i); float rr=sqrt((fi+0.5)/64.0)*r; float a=fi*2.39996; acc+=T(uv+vec2(cos(a),sin(a))*rr*px); } o=acc/64.0;`,
  dirblur: `float a=radians(P(0)); float L=P(1)*u_k; vec2 d=vec2(cos(a),sin(a))*px; vec4 acc=vec4(0.0); for(int i=0;i<40;i++){ float t=(float(i)/39.0-0.5)*L; acc+=T(uv+d*t);} o=acc/40.0;`,
  zoomblur: `vec2 c=vec2(P(1),P(2))/100.0; vec2 d=uv-c; vec4 acc=vec4(0.0); for(int i=0;i<40;i++){ float s=1.0-P(0)/100.0*0.5*float(i)/39.0; acc+=T(c+d*s);} o=acc/40.0;`,
  spinblur: `vec2 c=vec2(P(1),P(2))/100.0; float A=aspect(); vec2 d=(uv-c)*vec2(A,1.0); vec4 acc=vec4(0.0); for(int i=0;i<40;i++){ float a=radians(P(0))*(float(i)/39.0-0.5); vec2 r=vec2(cos(a)*d.x-sin(a)*d.y, sin(a)*d.x+cos(a)*d.y); acc+=T(c+r/vec2(A,1.0)); } o=acc/40.0;`,
  sharpen: `vec4 nn=T(uv+vec2(0.0,px.y)),ss=T(uv-vec2(0.0,px.y)),ee=T(uv+vec2(px.x,0.0)),ww=T(uv-vec2(px.x,0.0)); o=clamp(C+P(0)/100.0*(4.0*C-nn-ss-ee-ww),0.0,1.0); o.rgb=min(o.rgb,vec3(o.a));`,
  unsharpcomb: `vec4 orig=T2(uv); vec4 diff=orig-C; if(abs(luma(diff.rgb))<P(1)/255.0) diff=vec4(0.0); o=clamp(orig+diff*P(0)/100.0,0.0,1.0); o.rgb=min(o.rgb,vec3(o.a));`,
  levels: `X=clamp((X-P(0)/255.0)/max((P(1)-P(0))/255.0,0.001),0.0,1.0); X=pow(X,vec3(1.0/max(P(2),0.01))); X=mix(vec3(P(3)/255.0),vec3(P(4)/255.0),X); o=pre(X,C.a);`,
  chmix: `X=vec3(dot(X,vec3(P(0),P(1),P(2))),dot(X,vec3(P(3),P(4),P(5))),dot(X,vec3(P(6),P(7),P(8))))/100.0; o=pre(X,C.a);`,
  exposure: `X=pow(max(X*exp2(P(0))+P(1),0.0),vec3(1.0/max(P(2),0.01))); o=pre(X,C.a);`,
  invert: `vec3 Y=X; int ch=int(P(0)+0.5); if(ch==0) Y=1.0-X; else if(ch==1) Y.r=1.0-X.r; else if(ch==2) Y.g=1.0-X.g; else if(ch==3) Y.b=1.0-X.b; else { float l=luma(X); Y=X+(1.0-2.0*l); } o=pre(mix(X,Y,P(1)/100.0),C.a);`,
  rgbsplit: `float a=radians(P(1)); vec2 d=vec2(cos(a),sin(a))*P(0)*u_k*px; vec4 r=T(uv+d), b=T(uv-d); o=vec4(r.r, C.g, b.b, max(C.a,max(r.a,b.a)));`,
  chswap: `int m=int(P(0)+0.5); vec3 Y=X; if(m==1)Y=X.rbg; else if(m==2)Y=X.grb; else if(m==3)Y=X.gbr; else if(m==4)Y=X.brg; else if(m==5)Y=X.bgr; o=pre(Y,C.a);`,
  brightness: `X=(X-0.5)*(1.0+P(1)/100.0)+0.5+P(0)/200.0; o=pre(X,C.a);`,
  colorbal: `float l=luma(X); float ws=1.0-smoothstep(0.0,0.5,l), wh=smoothstep(0.5,1.0,l), wm=clamp(1.0-ws-wh,0.0,1.0); X+=(vec3(P(0),P(1),P(2))*ws+vec3(P(3),P(4),P(5))*wm+vec3(P(6),P(7),P(8))*wh)/100.0*0.3; o=pre(X,C.a);`,
  hsl: `vec3 h=rgb2hsv(clamp(X,0.0,1.0)); h.x=fract(h.x+P(0)/360.0); h.y=clamp(h.y*(1.0+P(1)/100.0),0.0,1.0); X=hsv2rgb(h); X=P(2)>0.0? mix(X,vec3(1.0),P(2)/100.0) : mix(X,vec3(0.0),-P(2)/100.0); o=pre(X,C.a);`,
  leavecolor: `vec3 h=rgb2hsv(clamp(X,0.0,1.0)), k=rgb2hsv(u_c0); float d=hueDist(h.x,k.x)*2.0+max(0.0,0.25-h.y)*2.0; float keep=1.0-smoothstep(P(0)/200.0, P(0)/200.0+P(1)/200.0+0.001, d); o=pre(mix(vec3(luma(X)),X,max(keep,1.0-P(2)/100.0)),C.a);`,
  changecolor: `vec3 h=rgb2hsv(clamp(X,0.0,1.0)), k=rgb2hsv(u_c0); float d=hueDist(h.x,k.x)*2.0+max(0.0,0.2-h.y)*2.0; float m=1.0-smoothstep(P(2)/200.0,P(2)/200.0+P(3)/200.0+0.001,d); h.x=fract(h.x+m*P(0)/360.0); h.y=clamp(h.y*(1.0+m*P(1)/100.0),0.0,1.0); o=pre(hsv2rgb(h),C.a);`,
  tint: `o=pre(mix(X,mix(u_c0,u_c1,luma(X)),P(0)/100.0),C.a);`,
  photofilter: `vec3 Y=mix(X,X*u_c0*1.5,P(0)/100.0); if(P(1)>0.5) Y*=luma(X)/max(luma(Y),0.0001); o=pre(Y,C.a);`,
  bw: `o=pre(mix(X,vec3(dot(X,vec3(P(1),P(2),P(3))/max(P(1)+P(2)+P(3),1.0))),P(0)/100.0),C.a);`,
  sepia: `vec3 s=vec3(dot(X,vec3(.393,.769,.189)),dot(X,vec3(.349,.686,.168)),dot(X,vec3(.272,.534,.131))); o=pre(mix(X,s,P(0)/100.0),C.a);`,
  huerot: `vec3 h=rgb2hsv(clamp(X,0.0,1.0)); h.x=fract(h.x+P(0)/360.0); o=pre(hsv2rgb(h),C.a);`,
  vibrance: `float l=luma(X); float mx=max(X.r,max(X.g,X.b)), mn=min(X.r,min(X.g,X.b)); X=mix(vec3(l),X,1.0+P(0)/100.0*(1.0-(mx-mn))); X=mix(vec3(luma(X)),X,1.0+P(1)/100.0); o=pre(X,C.a);`,
  temperature: `X.r*=1.0+P(0)/100.0*0.2; X.b*=1.0-P(0)/100.0*0.2; X.g*=1.0-P(1)/100.0*0.14; o=pre(X,C.a);`,
  gamma: `o=pre(pow(max(X,0.0),vec3(1.0/max(P(0),0.01))),C.a);`,
  colorreplace: `float d=distance(X,u_c0); float m=1.0-smoothstep(P(0)/100.0*0.6,P(0)/100.0*0.6+P(1)/100.0*0.4+0.001,d); vec3 rep=u_c1*(luma(X)/max(luma(u_c1),0.05)); o=pre(mix(X,clamp(rep,0.0,1.0),m),C.a);`,
  colorbalrgb: `o=pre(X*vec3(P(0),P(1),P(2))/100.0,C.a);`,
  lens: `float A=aspect(); vec2 d=(uv-0.5)*vec2(A,1.0); float r2=dot(d,d); vec2 q=d*(1.0+P(0)/100.0*0.6*r2)/(P(1)/100.0); o=Tz(q/vec2(A,1.0)+0.5);`,
  wave: `vec2 pp=uv*u_res; float hgt=P(0)*u_k, wl=max(P(1)*u_k,1.0); vec2 q=uv; float ph=u_lt*P(2)*6.2831; if(P(3)<0.5) q.x+=sin(pp.y/wl*6.2831+ph)*hgt*px.x; else q.y+=sin(pp.x/wl*6.2831+ph)*hgt*px.y; o=Tz(q);`,
  twirl: `float A=aspect(); vec2 c=vec2(P(2),P(3))/100.0; vec2 d=(uv-c)*vec2(A,1.0); float R=P(1)/100.0*0.5*A; float r=length(d); if(r<R){ float a=radians(P(0))*(1.0-r/R)*(1.0-r/R); d=vec2(cos(a)*d.x-sin(a)*d.y, sin(a)*d.x+cos(a)*d.y);} o=Tz(c+d/vec2(A,1.0));`,
  bulge: `float A=aspect(); vec2 c=vec2(P(2),P(3))/100.0; vec2 d=(uv-c)*vec2(A,1.0); float R=P(1)/100.0*0.5*A; float r=length(d); if(r<R&&r>0.0){ float t=r/R; float f=pow(t,1.0+P(0)/100.0*0.8)/t; f=mix(f,1.0,smoothstep(0.85,1.0,t)); d*=f; } o=Tz(c+d/vec2(A,1.0));`,
  magnify: `float A=aspect(); vec2 c=vec2(P(2),P(3))/100.0; vec2 d=(uv-c)*vec2(A,1.0); float R=P(1)/100.0*0.5; float r=length(d); if(r<R){ o=Tz(c+d/(P(0)/100.0)/vec2(A,1.0)); o=mix(o,vec4(1.0),smoothstep(R-0.006,R-0.002,r)*P(4)); } else o=C;`,
  ripple: `float A=aspect(); vec2 c=vec2(P(3),P(4))/100.0; vec2 d=(uv-c)*vec2(A,1.0); float r=length(d); float w=sin(r*P(1)*6.2831-u_lt*P(2)*3.0)*P(0)*u_k; vec2 nn=r>0.0?d/r:vec2(0.0); o=Tz(uv+nn*w*px);`,
  turb: `vec2 pp=uv*u_res/max(P(1)*u_k,1.0); float t=u_lt*P(2)*0.5; vec2 off=vec2(vnoise(pp+vec2(t,0.0))-0.5, vnoise(pp+vec2(5.2,1.3-t))-0.5)*2.0*P(0)*u_k; o=Tz(uv+off*px);`,
  mirror: `vec2 q=uv; int m=int(P(0)+0.5); if(m==0&&q.x>0.5) q.x=1.0-q.x; else if(m==1&&q.x<0.5) q.x=1.0-q.x; else if(m==2&&q.y>0.5) q.y=1.0-q.y; else if(m==3&&q.y<0.5) q.y=1.0-q.y; else if(m==4) q=0.5-abs(q-0.5); o=T(q);`,
  offset: `o=T(fract(uv-vec2(P(0),P(1))/100.0));`,
  ramp: `float t; if(P(2)<0.5){ float a=radians(P(0)); vec2 d=vec2(sin(a),-cos(a)); t=dot(uv-0.5,d)/(abs(d.x)*0.5+abs(d.y)*0.5)*0.5+0.5;} else t=length((uv-0.5)*vec2(aspect(),1.0))/length(vec2(aspect(),1.0)*0.5); o=mix(C,vec4(mix(u_c0,u_c1,clamp(t,0.0,1.0)),1.0),P(1)/100.0);`,
  grid: `vec2 pp=uv*u_res; float s=max(P(0)*u_k,2.0), th=P(1)*u_k; vec2 m=mod(pp,s); float a=((m.x<th||m.y<th)?1.0:0.0)*P(2)/100.0; o=vec4(C.rgb*(1.0-a)+u_c0*a, max(C.a,a));`,
  checker: `vec2 pp=floor(uv*u_res/max(P(0)*u_k,2.0)); vec3 g=mod(pp.x+pp.y,2.0)<1.0?u_c0:u_c1; float a=P(1)/100.0; o=vec4(C.rgb*(1.0-a)+g*a, max(C.a,a));`,
  circle: `float A=aspect(); vec2 d=(uv-vec2(P(0),P(1))/100.0)*vec2(A,1.0); float r=P(2)/100.0*0.5*A; float f=max(P(3)/100.0*0.5,0.0005); float m=1.0-smoothstep(r-f,r+f,length(d)); if(P(4)>0.5) m=1.0-m; float a=m*P(5)/100.0; o=vec4(C.rgb*(1.0-a)+u_c0*a, max(C.a,a));`,
  flare: `float A=aspect(); vec2 c=vec2(P(0),P(1))/100.0; vec2 d=(uv-c)*vec2(A,1.0); float r=length(d); float b=P(2)/100.0;
    vec3 add=u_c0*(0.003/(r*r+0.0006))*b; add+=u_c0*exp(-abs(d.y)*90.0)*exp(-abs(d.x)*2.5)*0.6*b;
    vec2 ax=(vec2(0.5)-c)*vec2(A,1.0); for(int i=1;i<5;i++){ vec2 g=d-ax*float(i)*0.55; add+=u_c0*vec3(0.6,0.8,1.0)*smoothstep(0.05,0.0,abs(length(g)-0.025*float(i)))*0.18*b; }
    o=vec4(min(C.rgb+add,1.0), max(C.a,clamp(luma(add),0.0,1.0)));`,
  fill: `o=vec4(mix(C.rgb,u_c0*C.a,P(0)/100.0),C.a);`,
  lightleak: `float t=u_lt*P(1)*0.2; vec2 q=uv*vec2(aspect(),1.0); float n1=vnoise(q*1.5+vec2(t,t*0.7)); float n2=vnoise(q*2.3-vec2(t*0.8,t*0.3)+7.0); float m=smoothstep(0.45,1.0,n1)*(1.0-uv.y*0.3); float m2=smoothstep(0.5,1.0,n2); vec3 L=clamp((u_c0*m+u_c1*m2)*P(0)/100.0,0.0,1.0); o=vec4(C.rgb+L*(C.a-C.rgb),C.a);`,
  chromakey: `float d=distance(cbcr(X),cbcr(u_c0)); float m=smoothstep(P(0)/100.0*0.35, P(0)/100.0*0.35+P(1)/100.0*0.25+0.0001, d); float sp=P(2)/100.0; float l=dot(X,vec3(.299,.587,.114)); X=mix(X,vec3(l),(1.0-m)*sp);
    if(u_c0.g>u_c0.r&&u_c0.g>u_c0.b) X.g=mix(X.g,min(X.g,max(X.r,X.b)),sp); else if(u_c0.b>u_c0.r&&u_c0.b>u_c0.g) X.b=mix(X.b,min(X.b,max(X.r,X.g)),sp);
    float a=C.a*m; if(P(3)>0.5){ o=vec4(vec3(a),1.0); } else o=pre(X,a);`,
  lumakey: `float m=smoothstep(P(0)/100.0, P(0)/100.0+P(1)/100.0+0.001, luma(X)); if(P(2)>0.5) m=1.0-m; o=C*m;`,
  colorkey: `float m=smoothstep(P(0)/100.0*0.8, P(0)/100.0*0.8+P(1)/100.0*0.4+0.001, distance(X,u_c0)); o=C*m;`,
  alphaadj: `float a=C.a; if(P(2)>0.5) a=1.0; if(P(1)>0.5) a=1.0-a; a*=P(0)/100.0; o=pre(X,a);`,
  noise: `float t=P(2)>0.5?floor(u_lt*24.0):0.0; vec2 q=uv*u_res+t*17.13; vec3 nn=P(1)>0.5? vec3(hash(q),hash(q+3.1),hash(q+7.7)) : vec3(hash(q)); o=pre(X+(nn-0.5)*P(0)/100.0,C.a);`,
  grain: `vec2 q=floor(uv*u_res/max(P(1),1.0))+floor(u_lt*24.0)*13.7; float g=hash(q)+hash(q+1.7)-1.0; float l=luma(X); o=pre(X+g*P(0)/100.0*0.35*(1.0-abs(l-0.5)),C.a);`,
  median: `vec3 v[9]; int k=0; float r=max(P(0),1.0)*u_k; for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){ v[k]=unp(T(uv+vec2(float(i),float(j))*px*r)); k++; }
#define S2(a,b) { vec3 tt=min(v[a],v[b]); v[b]=max(v[a],v[b]); v[a]=tt; }
    S2(1,2) S2(4,5) S2(7,8) S2(0,1) S2(3,4) S2(6,7) S2(1,2) S2(4,5) S2(7,8) S2(0,3) S2(5,8) S2(4,7) S2(3,6) S2(1,4) S2(2,5) S2(4,7) S2(4,2) S2(6,4) S2(4,2)
    o=pre(v[4],C.a);`,
  dust: `float t=floor(u_lt*12.0); float a=P(0)/100.0; vec2 q=uv*vec2(aspect(),1.0)*40.0; float d=step(1.0-0.004*a, hash(floor(q)+t*3.1)); float sx=hash(vec2(t,1.0)); float scr=step(0.6,hash(vec2(t,9.0)))*smoothstep(0.0015,0.0,abs(uv.x-sx))*a; o=pre(mix(X,vec3(0.08),max(d*0.8,scr*0.7)),C.a);`,
  shadowcomb: `float a=radians(P(1)); vec2 off=vec2(sin(a),-cos(a))*P(2)*u_k*px; float sa=T(uv-off).a*P(0)/100.0; vec4 sh=vec4(u_c0*sa,sa); vec4 orig=T2(uv); o = P(4)>0.5 ? sh : orig + sh*(1.0-orig.a);`,
  basic3d: `float A=aspect(); vec2 pp=(uv-0.5)*2.0; pp.x*=A; float f=3.0; float sw=radians(P(0)), tl=radians(P(1));
    mat3 Ry=mat3(cos(sw),0.0,-sin(sw), 0.0,1.0,0.0, sin(sw),0.0,cos(sw)); mat3 Rx=mat3(1.0,0.0,0.0, 0.0,cos(tl),sin(tl), 0.0,-sin(tl),cos(tl)); mat3 R=Ry*Rx;
    vec3 E=vec3(0.0,0.0,f); vec3 dir=vec3(pp,-f); vec3 nn=R*vec3(0.0,0.0,1.0); vec3 Q0=vec3(0.0,0.0,-P(2)/100.0*f);
    float dn=dot(dir,nn); if(abs(dn)<1e-4){o=vec4(0.0);return;} float s=dot(Q0-E,nn)/dn; if(s<0.0){o=vec4(0.0);return;}
    vec3 Xp=E+s*dir; vec3 L=transpose(R)*(Xp-Q0); o=Tz(vec2(L.x/A,L.y)*0.5+0.5);`,
  bevel: `vec2 bs=max(u_box.zw-u_box.xy,vec2(1e-4)); vec2 p=(uv-u_box.xy)/bs; vec2 sz=max(P(0)*u_k/(bs*u_res),vec2(1e-4)); float l=min(p.x/sz.x,p.y/sz.y); float r=min((1.0-p.x)/sz.x,(1.0-p.y)/sz.y); float k=P(1)/100.0*0.5; if(l<1.0&&l<r) X+=k*(1.0-l); else if(r<1.0) X-=k*(1.0-r); o=pre(X,C.a);`,
  edges: `vec3 nn=unp(T(uv+vec2(0.0,px.y))),ss=unp(T(uv-vec2(0.0,px.y))),ee=unp(T(uv+vec2(px.x,0.0))),ww=unp(T(uv-vec2(px.x,0.0))); vec3 ed=abs(ee-ww)+abs(nn-ss); vec3 Y= P(1)>0.5 ? clamp(ed*2.0,0.0,1.0) : 1.0-clamp(ed*2.0,0.0,1.0); o=pre(mix(X,Y,P(0)/100.0),C.a);`,
  emboss: `float a=radians(P(1)); vec2 d=vec2(cos(a),sin(a))*px*max(P(2),1.0); vec3 aa=unp(T(uv-d)), bb=unp(T(uv+d)); float e=luma(bb-aa)*2.5+0.5; o=pre(mix(X,vec3(e),P(0)/100.0),C.a);`,
  coloremboss: `vec3 aa=unp(T(uv-px)), bb=unp(T(uv+px)); o=pre(X+(bb-aa)*2.0*P(0)/100.0,C.a);`,
  mosaic: `vec2 cell=vec2(max(P(0),1.0),max(P(1),1.0)); o=T((floor(uv*cell)+0.5)/cell);`,
  posterize: `float L=max(P(0),2.0)-1.0; o=pre(floor(X*L+0.5)/L,C.a);`,
  glowcomb: `vec4 orig=T2(uv); vec3 b=unp(C); float l=luma(b); vec3 g=b*smoothstep(P(0)/100.0, P(0)/100.0+0.2, l); if(P(3)>0.5) g=u_c0*luma(g)*2.0; vec3 add=g*C.a*P(2)/100.0*1.5; o=vec4(min(orig.rgb+add,1.0), max(orig.a, min(1.0,luma(add))));`,
  replicate: `o=T(fract(uv*max(floor(P(0)),1.0)));`,
  solarize: `o=pre(mix(X,1.0-X,step(vec3(P(0)/100.0),X)),C.a);`,
  strobe: `float on=step(0.5,fract(u_lt*P(0))); if(P(2)>0.5) o=C*(1.0-on*P(1)/100.0); else o=vec4(mix(C.rgb,u_c0*C.a,on*P(1)/100.0),C.a);`,
  threshold: `o=pre(vec3(step(P(0)/255.0,luma(X))),C.a);`,
  cartoon: `vec3 nn=unp(T(uv+vec2(0.0,px.y))),ss=unp(T(uv-vec2(0.0,px.y))),ee=unp(T(uv+vec2(px.x,0.0))),ww=unp(T(uv-vec2(px.x,0.0))); float ed=luma(abs(ee-ww)+abs(nn-ss)); float L=max(P(0),2.0)-1.0; vec3 Y=floor(X*L+0.5)/L; Y*=1.0-smoothstep(P(2)/100.0*0.3,P(2)/100.0*0.3+0.1,ed)*P(1)/100.0; o=pre(Y,C.a);`,
  halftone: `float s=max(P(0)*u_k,2.0); float a=radians(P(1)); mat2 r=mat2(cos(a),-sin(a),sin(a),cos(a)); vec2 pp=r*(uv*u_res); vec2 cell=(floor(pp/s)+0.5)*s; vec2 cuv=(transpose(r)*cell)/u_res; vec3 cc=unp(T(cuv)); float l=luma(cc); float rad=s*0.5*sqrt(1.0-l)*1.2; float m=1.0-smoothstep(rad-1.0,rad+1.0,length(pp-cell)); vec3 Y=P(2)>0.5? mix(vec3(1.0),cc,m) : vec3(1.0-m); o=pre(Y,C.a);`,
  sketch: `vec3 nn=unp(T(uv+vec2(0.0,px.y))),ss=unp(T(uv-vec2(0.0,px.y))),ee=unp(T(uv+vec2(px.x,0.0))),ww=unp(T(uv-vec2(px.x,0.0))); float ed=luma(abs(ee-ww)+abs(nn-ss)); vec3 Y=vec3((1.0-clamp(ed*3.0,0.0,1.0))*(0.85+0.15*luma(X))); Y*=0.95+0.05*hash(floor(uv*u_res*0.5)); o=pre(mix(X,Y,P(0)/100.0),C.a);`,
  neonedges: `vec3 nn=unp(T(uv+vec2(0.0,px.y))),ss=unp(T(uv-vec2(0.0,px.y))),ee=unp(T(uv+vec2(px.x,0.0))),ww=unp(T(uv-vec2(px.x,0.0))); float ed=luma(abs(ee-ww)+abs(nn-ss)); o=pre(X*0.15+u_c0*clamp(ed*4.0,0.0,1.0)*P(0)/50.0, C.a);`,
  oilpaint: `int R=int(clamp(P(0),1.0,6.0)); vec3 m0=vec3(0.0),m1=vec3(0.0),m2=vec3(0.0),m3=vec3(0.0),s0=vec3(0.0),s1=vec3(0.0),s2=vec3(0.0),s3=vec3(0.0); float nr=float((R+1)*(R+1));
    for(int j=-6;j<=6;j++){ for(int i=-6;i<=6;i++){ if(abs(i)>R||abs(j)>R) continue; vec3 c=unp(T(uv+vec2(float(i),float(j))*px*u_k));
      if(i<=0&&j<=0){m0+=c;s0+=c*c;} if(i>=0&&j<=0){m1+=c;s1+=c*c;} if(i<=0&&j>=0){m2+=c;s2+=c*c;} if(i>=0&&j>=0){m3+=c;s3+=c*c;} } }
    vec3 mu; vec3 res=m0/nr; vec3 v=abs(s0/nr-res*res); float best=v.r+v.g+v.b;
    mu=m1/nr; v=abs(s1/nr-mu*mu); if(v.r+v.g+v.b<best){best=v.r+v.g+v.b;res=mu;}
    mu=m2/nr; v=abs(s2/nr-mu*mu); if(v.r+v.g+v.b<best){best=v.r+v.g+v.b;res=mu;}
    mu=m3/nr; v=abs(s3/nr-mu*mu); if(v.r+v.g+v.b<best){best=v.r+v.g+v.b;res=mu;}
    o=pre(res,C.a);`,
  vhs: `float a=P(0)/100.0; float t=u_lt; float line=floor(uv.y*u_res.y/2.0);
    float jit=(hash(vec2(line,floor(t*30.0)))-0.5)*0.004*a+sin(uv.y*40.0+t*5.0)*0.0015*a; vec2 q=uv+vec2(jit,0.0); float sh=0.004*a;
    vec3 c=vec3(unp(T(q+vec2(sh,0.0))).r, unp(T(q)).g, unp(T(q-vec2(sh,0.0))).b);
    c=mix(c,(c+unp(T(q+vec2(px.x*3.0,0.0)))+unp(T(q-vec2(px.x*3.0,0.0))))/3.0,0.5*a);
    c*=1.0-0.1*a*(0.5+0.5*sin(uv.y*u_res.y*1.5)); c+=(hash(uv*u_res+floor(t*24.0)*7.0)-0.5)*0.12*a;
    c+=smoothstep(0.98,1.0,sin(uv.y*6.0+t*2.0))*a*0.15; c=mix(c,c*vec3(1.05,0.95,1.08),a*0.5); o=pre(c,C.a);`,
  glitch: `float a=P(0)/100.0; float t=floor(u_lt*P(1)); vec2 q=uv; float blk=floor(uv.y*14.0+hash(vec2(t,2.0))*4.0);
    if(hash(vec2(blk,t))<0.25*a) q.x+=(hash(vec2(blk,t+1.0))-0.5)*0.15*a;
    float sh=(hash(vec2(t,5.0))-0.5)*0.02*a; vec4 cr=T(q+vec2(sh,0.0)), cg=T(q), cb=T(q-vec2(sh,0.0));
    o=vec4(cr.r,cg.g,cb.b,max(cg.a,max(cr.a,cb.a))); if(hash(vec2(floor(uv.y*60.0),t))<0.03*a) o.rgb=o.a*vec3(hash(vec2(t,uv.y)));`,
  scanlines: `o=pre(X*(1.0-P(1)/100.0*(0.5+0.5*sin(uv.y*P(0)*6.28318))),C.a);`,
  oldfilm: `float a=P(0)/100.0; float t=floor(u_lt*18.0); vec3 s=vec3(dot(X,vec3(.393,.769,.189)),dot(X,vec3(.349,.686,.168)),dot(X,vec3(.272,.534,.131)));
    X=mix(X,s,a); X*=1.0-a*0.15*hash(vec2(t,3.0)); X*=1.0-a*smoothstep(0.3,0.75,length(uv-0.5));
    X+=(hash(uv*u_res+t*11.0)-0.5)*0.15*a; float sx=hash(vec2(t,7.0)); X-=step(0.5,hash(vec2(t,8.0)))*smoothstep(0.002,0.0,abs(uv.x-sx))*0.5*a; o=pre(X,C.a);`,
  letterbox: `float rs[6]=float[6](2.39,2.35,2.0,1.85,1.3333,1.0); float r=rs[int(clamp(P(0),0.0,5.0)+0.5)]; float fa=aspect(); float m;
    if(r>fa){ m=step(abs(uv.y-0.5),fa/r*0.5); } else { m=step(abs(uv.x-0.5),r/fa*0.5); } float a=(1.0-m)*P(1)/100.0; o=vec4(C.rgb*(1.0-a)+u_c0*a, max(C.a,a));`,
  crt: `vec2 d=uv-0.5; vec2 q=0.5+d*(1.0+P(0)/100.0*0.25*dot(d,d)*4.0); vec4 c=Tz(q); vec3 x=unp(c); x*=1.0-P(1)/100.0*0.5*(0.5+0.5*sin(q.y*u_res.y*3.14159)); x*=1.0-P(2)/100.0*smoothstep(0.35,0.75,length(d)); o=pre(x,c.a);`,
  edgefeather: `vec2 bs=max(u_box.zw-u_box.xy,vec2(1e-4)); vec2 p=(uv-u_box.xy)/bs; vec2 f=max(P(0)*u_k/(bs*u_res),vec2(1e-5)); o=C*smoothstep(0.0,f.x,p.x)*smoothstep(0.0,f.x,1.0-p.x)*smoothstep(0.0,f.y,p.y)*smoothstep(0.0,f.y,1.0-p.y);`,
  rounded: `vec2 sz=(u_box.zw-u_box.xy)*u_res; vec2 p=(uv-u_box.xy)*u_res; float r=min(P(0)*u_k,min(sz.x,sz.y)*0.5); vec2 q=abs(p-sz*0.5)-(sz*0.5-r); float d=length(max(q,0.0))+min(max(q.x,q.y),0.0)-r; o=C*(1.0-smoothstep(-1.0,1.0,d));`,
  linwipe: `float a=radians(P(1)); vec2 d=vec2(sin(a),-cos(a)); float pr=dot(uv-0.5,d)/(abs(d.x)*0.5+abs(d.y)*0.5)*0.5+0.5; float f=max(P(2)/100.0,0.001); float c=P(0)/100.0*(1.0+f); o=C*smoothstep(c-f,c,pr);`,
  radwipe: `float an=fract((atan(uv.x-0.5,-(uv.y-0.5))-radians(P(1)))/6.28318); float f=max(P(2)/100.0,0.001); float c=P(0)/100.0*(1.0+f); o=C*smoothstep(c-f,c,an);`,
  blockdis: `float h=hash(floor(uv*u_res/max(P(1)*u_k,1.0))); float f=max(P(2)/100.0,0.001); float c=P(0)/100.0*(1.0+f); o=C*smoothstep(c-f,c,h);`,
  blinds: `float a=radians(P(1)); float pr=dot(uv*u_res,vec2(cos(a),sin(a)))/max(P(2)*u_k,1.0); o=C*step(P(0)/100.0,fract(pr));`,
  lumetri: `if(P(11)>0.0){ vec3 nn=unp(T(uv+vec2(0.0,px.y))),ss=unp(T(uv-vec2(0.0,px.y))),ee=unp(T(uv+vec2(px.x,0.0))),ww=unp(T(uv-vec2(px.x,0.0))); X+=P(11)*(4.0*X-nn-ss-ee-ww); }
    X.r*=1.0+P(6)*0.20; X.b*=1.0-P(6)*0.20; X.g*=1.0-P(7)*0.14; X.r*=1.0+P(7)*0.05; X.b*=1.0+P(7)*0.05;
    X*=exp2(P(0)); float l=luma(X);
    X+=vec3(P(3)*0.22*(1.0-smoothstep(0.0,0.55,l))); X+=vec3(P(2)*0.22*smoothstep(0.45,1.0,l));
    float bp=-P(5)*0.10; float wp=1.0-P(4)*0.18; X=(X-bp)/max(wp-bp,0.05);
    X=(X-0.5)*(1.0+P(1))+0.5; l=luma(X); X=mix(vec3(l),X,P(8));
    float mx=max(X.r,max(X.g,X.b)), mn=min(X.r,min(X.g,X.b)); X=mix(vec3(l),X,1.0+P(9)*(1.0-clamp(mx-mn,0.0,1.0)));
    l=clamp(l,0.0,1.0); X+=u_c0*(1.0-l)+u_c1*l; X=mix(X,X*0.82+0.12,P(10));
    if(P(12)!=0.0){ vec2 d=(uv-0.5)*vec2(aspect(),1.0); float r=length(d)/length(vec2(aspect()*0.5,0.5)); float v=smoothstep(P(13),P(13)+P(14),r); if(P(12)<0.0) X*=1.0+P(12)*v; else X=mix(X,vec3(1.0),P(12)*v); }
    o=pre(X,C.a);`
};

/* ---------- video effects catalog (folders like Premiere) ---------- */
const blurRun = (G, r, dim) => { if (r < 0.5) return; if (dim !== 2) G.pass('blur1d', [r, 1, 0]); if (dim !== 1) G.pass('blur1d', [r, 0, 1]); };
const V = [
  { cat: 'Dopasuj', items: [
    { id: 'levels', name: 'Poziomy', params: [n('ib', 'Wejściowa czerń', 0, 255, 0), n('iw', 'Wejściowa biel', 0, 255, 255), n('g', 'Gamma', 0.1, 5, 1, { step: 0.01 }), n('ob', 'Wyjściowa czerń', 0, 255, 0), n('ow', 'Wyjściowa biel', 0, 255, 255)] },
    { id: 'chmix', name: 'Mikser kanałów', params: [n('rr', 'Czerwony – czerwony', -200, 200, 100), n('rg', 'Czerwony – zielony', -200, 200, 0), n('rb', 'Czerwony – niebieski', -200, 200, 0), n('gr', 'Zielony – czerwony', -200, 200, 0), n('gg', 'Zielony – zielony', -200, 200, 100), n('gb', 'Zielony – niebieski', -200, 200, 0), n('br', 'Niebieski – czerwony', -200, 200, 0), n('bg', 'Niebieski – zielony', -200, 200, 0), n('bb', 'Niebieski – niebieski', -200, 200, 100)] },
    { id: 'exposure', name: 'Ekspozycja', params: [n('ev', 'Ekspozycja', -5, 5, 0.5, { step: 0.01 }), n('off', 'Przesunięcie', -0.5, 0.5, 0, { step: 0.001 }), n('g', 'Gamma', 0.1, 3, 1, { step: 0.01 })] },
    { id: 'gamma', name: 'Korekcja gamma', params: [n('g', 'Gamma', 0.1, 5, 1.2, { step: 0.01 })] }
  ] },
  { cat: 'Rozmycie i wyostrzanie', items: [
    { id: 'blur', name: 'Rozmycie gaussowskie', params: [n('amount', 'Rozmycie', 0, 300, 15), sel('dim', 'Wymiary rozmycia', ['Poziomo i pionowo', 'Poziomo', 'Pionowo'])], run: (G, P) => blurRun(G, P.amount * G.k, P.dim) },
    { id: 'camblur', name: 'Rozmycie aparatu', params: [n('r', 'Promień', 0, 100, 10)] },
    { id: 'chblur', name: 'Rozmycie kanałów', params: [n('r', 'Czerwony', 0, 100, 10), n('g', 'Zielony', 0, 100, 0), n('b', 'Niebieski', 0, 100, 20)], run: (G, P) => { G.pass('chblur1d', [P.r * G.k, P.g * G.k, P.b * G.k, 1, 0]); G.pass('chblur1d', [P.r * G.k, P.g * G.k, P.b * G.k, 0, 1]); } },
    { id: 'dirblur', name: 'Rozmycie kierunkowe', params: [ang('a', 'Kierunek', 0), n('len', 'Długość rozmycia', 0, 400, 40)] },
    { id: 'zoomblur', name: 'Rozmycie radialne (zoom)', params: [n('amt', 'Ilość', 0, 100, 25), cx(), cy()] },
    { id: 'spinblur', name: 'Rozmycie obrotowe', params: [n('a', 'Kąt', 0, 90, 10), cx(), cy()] },
    { id: 'sharpen', name: 'Wyostrzanie', params: [n('amount', 'Ilość wyostrzenia', 0, 400, 60)] },
    { id: 'unsharp', name: 'Maska wyostrzająca', params: [n('amount', 'Ilość', 0, 500, 120), n('r', 'Promień', 0.5, 40, 3, { step: 0.1 }), n('th', 'Próg', 0, 255, 0)], run: (G, P) => { G.saveAux(); blurRun(G, P.r * G.k, 0); G.pass('unsharpcomb', [P.amount, P.th], { aux: true }); } }
  ] },
  { cat: 'Kanał', items: [
    { id: 'invert', name: 'Odwróć', params: [sel('ch', 'Kanał', ['RGB', 'Czerwony', 'Zielony', 'Niebieski', 'Luminancja']), n('amount', 'Mieszanie z oryginałem', 0, 100, 100)] },
    { id: 'rgbsplit', name: 'Przesunięcie kanałów RGB', params: [n('amount', 'Przesunięcie', 0, 100, 8), ang('a', 'Kąt', 0)] },
    { id: 'chswap', name: 'Zamiana kanałów', params: [sel('m', 'Kolejność', ['RGB', 'RBG', 'GRB', 'GBR', 'BRG', 'BGR'], 5)] }
  ] },
  { cat: 'Korekcja kolorów', items: [
    { id: 'brightness', name: 'Jasność i kontrast', params: [n('brightness', 'Jasność', -100, 100, 0), n('contrast', 'Kontrast', -100, 100, 0)] },
    { id: 'colorbal', name: 'Balans kolorów', params: [n('sr', 'Cienie – czerwony', -100, 100, 0), n('sg', 'Cienie – zielony', -100, 100, 0), n('sb', 'Cienie – niebieski', -100, 100, 0), n('mr', 'Półtony – czerwony', -100, 100, 0), n('mg', 'Półtony – zielony', -100, 100, 0), n('mb', 'Półtony – niebieski', -100, 100, 0), n('hr', 'Światła – czerwony', -100, 100, 0), n('hg', 'Światła – zielony', -100, 100, 0), n('hb', 'Światła – niebieski', -100, 100, 0)] },
    { id: 'hsl', name: 'Barwa / nasycenie / jasność', params: [ang('h', 'Barwa', 0), n('s', 'Nasycenie', -100, 100, 0), n('l', 'Jasność', -100, 100, 0)] },
    { id: 'leavecolor', name: 'Pozostaw kolor', params: [col('c', 'Kolor do zachowania', '#e02020'), n('tol', 'Tolerancja', 0, 100, 25), n('soft', 'Miękkość krawędzi', 0, 100, 15), n('amount', 'Ilość odbarwienia', 0, 100, 100)] },
    { id: 'changecolor', name: 'Zmień kolor', params: [col('c', 'Kolor do zmiany', '#e02020'), ang('h', 'Zmiana barwy', 120), n('s', 'Zmiana nasycenia', -100, 100, 0), n('tol', 'Tolerancja', 0, 100, 25), n('soft', 'Miękkość', 0, 100, 15)] },
    { id: 'tint', name: 'Zabarwienie', params: [col('black', 'Mapuj czerń na', '#000000'), col('white', 'Mapuj biel na', '#ffb36b'), n('amount', 'Ilość', 0, 100, 60)] },
    { id: 'photofilter', name: 'Filtr fotograficzny', params: [col('c', 'Kolor filtra', '#ec8a00'), n('d', 'Gęstość', 0, 100, 25), chk('pl', 'Zachowaj jasność', true)] },
    { id: 'bw', name: 'Czarno-białe', params: [n('amount', 'Ilość', 0, 100, 100), n('r', 'Udział czerwieni', 0, 200, 21), n('g', 'Udział zieleni', 0, 200, 72), n('b', 'Udział błękitu', 0, 200, 7)] },
    { id: 'sepia', name: 'Sepia', params: [n('amount', 'Ilość', 0, 100, 100)] },
    { id: 'huerot', name: 'Obrót barwy', params: [ang('angle', 'Kąt', 90)] },
    { id: 'vibrance', name: 'Jaskrawość i nasycenie', params: [n('v', 'Jaskrawość', -100, 100, 40), n('s', 'Nasycenie', -100, 100, 0)] },
    { id: 'temperature', name: 'Temperatura i odcień', params: [n('t', 'Temperatura', -100, 100, 20), n('tint', 'Odcień', -100, 100, 0)] },
    { id: 'colorreplace', name: 'Zastąpienie koloru', params: [col('c', 'Kolor docelowy', '#2060e0'), col('r', 'Kolor zastępczy', '#e03030'), n('tol', 'Tolerancja', 0, 100, 30), n('soft', 'Miękkość', 0, 100, 20)] },
    { id: 'colorbalrgb', name: 'Balans kolorów (RGB)', params: [n('r', 'Czerwony', 0, 200, 100), n('g', 'Zielony', 0, 200, 100), n('b', 'Niebieski', 0, 200, 100)] }
  ] },
  { cat: 'Zniekształcenie', items: [
    { id: 'lens', name: 'Zniekształcenie obiektywu', params: [n('k', 'Krzywizna', -100, 100, 30), n('zoom', 'Skala', 50, 200, 100)] },
    { id: 'wave', name: 'Wypaczenie falowe', params: [n('h', 'Wysokość fali', 0, 200, 15), n('w', 'Szerokość fali', 1, 800, 120), n('sp', 'Szybkość', 0, 10, 1, { step: 0.1 }), sel('dir', 'Kierunek', ['Poziomo', 'Pionowo'])] },
    { id: 'twirl', name: 'Wir', params: [ang('a', 'Kąt', 180), n('r', 'Promień', 0, 100, 50), cx(), cy()] },
    { id: 'bulge', name: 'Wybrzuszenie', params: [n('a', 'Siła', -100, 100, 50), n('r', 'Promień', 0, 100, 45), cx(), cy()] },
    { id: 'magnify', name: 'Lupa', params: [n('z', 'Powiększenie', 100, 800, 200), n('s', 'Rozmiar', 1, 100, 25), cx(), cy(), chk('border', 'Obramowanie', true)] },
    { id: 'ripple', name: 'Zmarszczki', params: [n('a', 'Amplituda', 0, 100, 10), n('f', 'Częstotliwość', 1, 100, 20), n('sp', 'Szybkość', 0, 20, 3), cx(), cy()] },
    { id: 'turb', name: 'Turbulentne przemieszczenie', params: [n('a', 'Ilość', 0, 200, 30), n('s', 'Rozmiar', 1, 500, 100), n('sp', 'Szybkość', 0, 10, 1, { step: 0.1 })] },
    { id: 'mirror', name: 'Lustro', params: [sel('m', 'Tryb', ['Lewa strona na prawą', 'Prawa strona na lewą', 'Góra na dół', 'Dół na górę', 'Kalejdoskop (4)'])] },
    { id: 'offset', name: 'Przesunięcie z zawijaniem', params: [n('x', 'Przesunięcie X', -100, 100, 25, { unit: '%' }), n('y', 'Przesunięcie Y', -100, 100, 0, { unit: '%' })] }
  ] },
  { cat: 'Generuj', items: [
    { id: 'ramp', name: 'Gradient', params: [col('a', 'Kolor początkowy', '#000000'), col('b', 'Kolor końcowy', '#ffffff'), ang('angle', 'Kąt', 180), n('blend', 'Mieszanie z oryginałem', 0, 100, 50), sel('mode', 'Kształt', ['Liniowy', 'Promienisty'])] },
    { id: 'grid', name: 'Siatka', params: [n('s', 'Rozmiar', 2, 400, 80), n('t', 'Grubość', 0.5, 20, 2, { step: 0.5 }), col('c', 'Kolor', '#ffffff'), n('op', 'Krycie', 0, 100, 50)] },
    { id: 'checker', name: 'Szachownica', params: [n('s', 'Rozmiar', 2, 400, 60), col('a', 'Kolor 1', '#ffffff'), col('b', 'Kolor 2', '#000000'), n('op', 'Krycie', 0, 100, 100)] },
    { id: 'circle', name: 'Okrąg', params: [cx(), cy(), n('r', 'Promień', 0, 100, 25), n('f', 'Wtapianie', 0, 100, 2), col('c', 'Kolor', '#ffffff'), chk('inv', 'Odwróć', false), n('op', 'Krycie', 0, 100, 100)] },
    { id: 'flare', name: 'Flara obiektywu', params: [cx(30), cy(25), n('b', 'Jasność', 0, 300, 100), col('c', 'Kolor', '#ffd9a0')] },
    { id: 'fill', name: 'Wypełnienie kolorem', params: [col('c', 'Kolor', '#ff3060'), n('op', 'Krycie', 0, 100, 100)] },
    { id: 'lightleak', name: 'Przeciek światła', params: [n('i', 'Intensywność', 0, 100, 60), n('sp', 'Szybkość', 0, 10, 2, { step: 0.1 }), col('a', 'Kolor 1', '#ff7a2a'), col('b', 'Kolor 2', '#ffd34d')] }
  ] },
  { cat: 'Kluczowanie', items: [
    { id: 'chromakey', name: 'Ultra Key (zielony ekran)', params: [col('color', 'Kolor klucza', '#00ff00'), n('tolerance', 'Tolerancja', 0, 100, 30), n('softness', 'Miękkość', 0, 100, 12), n('spill', 'Usuwanie przebarwień', 0, 100, 50), chk('matte', 'Pokaż maskę alfa', false)] },
    { id: 'lumakey', name: 'Klucz luminancji', params: [n('th', 'Próg', 0, 100, 10), n('soft', 'Miękkość', 0, 100, 10), chk('inv', 'Odwróć', false)] },
    { id: 'colorkey', name: 'Klucz koloru', params: [col('c', 'Kolor klucza', '#0000ff'), n('tol', 'Tolerancja', 0, 100, 25), n('f', 'Wtapianie', 0, 100, 10)] },
    { id: 'alphaadj', name: 'Dopasowanie alfa', params: [n('op', 'Krycie', 0, 100, 100), chk('inv', 'Odwróć alfa', false), chk('ign', 'Ignoruj alfa', false)] }
  ] },
  { cat: 'Szum i ziarno', items: [
    { id: 'noise', name: 'Szum', params: [n('amount', 'Ilość szumu', 0, 100, 20), chk('color', 'Szum kolorowy', true), chk('anim', 'Animuj', true)] },
    { id: 'grain', name: 'Ziarno filmowe', params: [n('amount', 'Ilość', 0, 100, 30), n('size', 'Rozmiar', 1, 5, 1.5, { step: 0.1 })] },
    { id: 'median', name: 'Mediana (odszumianie)', params: [n('r', 'Promień', 1, 5, 1, { step: 0.5 })] },
    { id: 'dust', name: 'Kurz i rysy', params: [n('amount', 'Ilość', 0, 100, 40)] }
  ] },
  { cat: 'Perspektywa', items: [
    { id: 'shadow', name: 'Cień', params: [col('c', 'Kolor cienia', '#000000'), n('op', 'Krycie', 0, 100, 60), ang('a', 'Kierunek', 135), n('d', 'Odległość', 0, 300, 15), n('soft', 'Miękkość', 0, 100, 12), chk('only', 'Tylko cień', false)],
      run: (G, P) => { G.saveAux(); blurRun(G, P.soft * G.k, 0); G.pass('shadowcomb', [P.op, P.a, P.d, P.soft, P.only ? 1 : 0], { aux: true, c0: P.c }); } },
    { id: 'basic3d', name: 'Podstawowe 3D', params: [ang('sw', 'Obrót w poziomie', 25), ang('tl', 'Pochylenie', 0), n('d', 'Odległość', -50, 200, 0)] },
    { id: 'bevel', name: 'Fazowanie krawędzi', params: [n('s', 'Rozmiar', 0, 200, 12), n('i', 'Intensywność', 0, 100, 50)], box: true }
  ] },
  { cat: 'Stylizacja', items: [
    { id: 'edges', name: 'Znajdź krawędzie', params: [n('amount', 'Mieszanie', 0, 100, 100), chk('inv', 'Odwróć (ciemne tło)', false)] },
    { id: 'emboss', name: 'Płaskorzeźba', params: [n('amount', 'Mieszanie', 0, 100, 100), ang('a', 'Kierunek', 45), n('r', 'Wysokość', 1, 10, 1, { step: 0.5 })] },
    { id: 'coloremboss', name: 'Kolorowa płaskorzeźba', params: [n('amount', 'Kontrast', 0, 200, 100)] },
    { id: 'mosaic', name: 'Mozaika', params: [n('blocks', 'Bloki poziome', 2, 400, 40), n('vblocks', 'Bloki pionowe', 2, 400, 22)] },
    { id: 'posterize', name: 'Posteryzacja', params: [n('levels', 'Poziomy', 2, 32, 6)] },
    { id: 'glow', name: 'Poświata', params: [n('th', 'Próg', 0, 100, 55), n('radius', 'Promień', 1, 120, 20), n('amount', 'Intensywność', 0, 300, 80), chk('usec', 'Użyj koloru', false), col('c', 'Kolor', '#ffb070')],
      run: (G, P) => { G.saveAux(); blurRun(G, P.radius * G.k, 0); G.pass('glowcomb', [P.th, P.radius, P.amount, P.usec ? 1 : 0], { aux: true, c0: P.c }); } },
    { id: 'replicate', name: 'Replikuj', params: [n('count', 'Liczba', 2, 16, 2, { step: 1 })] },
    { id: 'solarize', name: 'Solaryzacja', params: [n('th', 'Próg', 0, 100, 50)] },
    { id: 'strobe', name: 'Światło stroboskopowe', params: [n('freq', 'Częstotliwość (Hz)', 0.5, 30, 6, { step: 0.5 }), n('amount', 'Intensywność', 0, 100, 80), sel('mode', 'Tryb', ['Błysk koloru', 'Przezroczystość']), col('c', 'Kolor', '#ffffff')] },
    { id: 'threshold', name: 'Próg', params: [n('lvl', 'Poziom', 0, 255, 128)] },
    { id: 'cartoon', name: 'Kreskówka', params: [n('lv', 'Poziomy kolorów', 2, 16, 6), n('es', 'Siła konturów', 0, 100, 80), n('et', 'Próg konturów', 0, 100, 30)] },
    { id: 'halftone', name: 'Raster (półton)', params: [n('s', 'Rozmiar punktu', 2, 60, 10), ang('a', 'Kąt', 45), chk('color', 'Kolorowy', true)] },
    { id: 'sketch', name: 'Szkic ołówkiem', params: [n('amount', 'Ilość', 0, 100, 100)] },
    { id: 'neonedges', name: 'Neonowe krawędzie', params: [n('i', 'Intensywność', 0, 200, 100), col('c', 'Kolor', '#30f0ff')] },
    { id: 'oilpaint', name: 'Obraz olejny', params: [n('r', 'Promień pędzla', 1, 6, 3, { step: 1 })] }
  ] },
  { cat: 'Retro i glitch', items: [
    { id: 'vhs', name: 'Kaseta VHS', params: [n('amount', 'Intensywność', 0, 100, 60)] },
    { id: 'glitch', name: 'Glitch cyfrowy', params: [n('amount', 'Intensywność', 0, 100, 50), n('sp', 'Szybkość', 1, 30, 8)] },
    { id: 'scanlines', name: 'Linie skanowania', params: [n('d', 'Liczba linii', 50, 1200, 360), n('i', 'Intensywność', 0, 100, 30)] },
    { id: 'oldfilm', name: 'Stary film', params: [n('amount', 'Intensywność', 0, 100, 70)] },
    { id: 'crt', name: 'Ekran CRT', params: [n('k', 'Krzywizna', 0, 100, 40), n('s', 'Linie', 0, 100, 40), n('v', 'Winieta', 0, 100, 50)] },
    { id: 'letterbox', name: 'Pasy filmowe (letterbox)', params: [sel('r', 'Proporcje', ['2.39:1 (kino)', '2.35:1', '2:1', '1.85:1', '4:3', '1:1']), n('op', 'Krycie', 0, 100, 100), col('c', 'Kolor', '#000000')] }
  ] },
  { cat: 'Czas', items: [
    { id: 'postime', name: 'Posteryzacja czasu', params: [n('fps', 'Klatki na sekundę', 1, 60, 12)], time: true }
  ] },
  { cat: 'Przekształć', items: [
    { id: 'hflip', name: 'Odbicie poziome', params: [], place: true },
    { id: 'vflip', name: 'Odbicie pionowe', params: [], place: true },
    { id: 'shake', name: 'Drgania kamery', params: [n('amount', 'Siła', 0, 100, 25), n('sp', 'Szybkość', 0.1, 5, 1, { step: 0.1 })], place: true },
    { id: 'edgefeather', name: 'Wtapianie krawędzi', params: [n('a', 'Szerokość', 0, 400, 40)], box: true },
    { id: 'rounded', name: 'Zaokrąglone rogi', params: [n('r', 'Promień', 0, 600, 40)], box: true }
  ] },
  { cat: 'Przejście (efekty)', items: [
    { id: 'linwipe', name: 'Wymazanie liniowe', params: [n('c', 'Ukończenie', 0, 100, 0, { unit: '%' }), ang('a', 'Kąt', 90), n('f', 'Wtapianie', 0, 100, 5)] },
    { id: 'radwipe', name: 'Wymazanie promieniowe', params: [n('c', 'Ukończenie', 0, 100, 0, { unit: '%' }), ang('a', 'Kąt początkowy', 0), n('f', 'Wtapianie', 0, 100, 3)] },
    { id: 'blockdis', name: 'Rozpuszczanie bloków', params: [n('c', 'Ukończenie', 0, 100, 0, { unit: '%' }), n('s', 'Rozmiar bloku', 2, 200, 20), n('f', 'Wtapianie', 0, 100, 0)] },
    { id: 'blinds', name: 'Żaluzje', params: [n('c', 'Ukończenie', 0, 100, 0, { unit: '%' }), ang('a', 'Kierunek', 90), n('w', 'Szerokość', 2, 300, 40)] }
  ] }
];
V.forEach(c => c.items.forEach(i => { i.gpu = true; if (!i.run && !i.place && !i.time && !SH[i.id]) console.warn('brak shadera', i.id); }));

/* ---------- audio effects ---------- */
const A = [
  { cat: 'Amplituda i kompresja', audio: true, items: [
    { id: 'gainfx', name: 'Wzmocnienie', params: [n('gain', 'Wzmocnienie (dB)', -30, 24, 6, { step: 0.1 })] },
    { id: 'compressor', name: 'Kompresor dynamiki', params: [n('th', 'Próg (dB)', -60, 0, -24), n('ratio', 'Stosunek', 1, 20, 4, { step: 0.1 }), n('att', 'Atak (ms)', 0, 500, 5), n('rel', 'Zwolnienie (ms)', 10, 1000, 150), n('makeup', 'Wzmocnienie wyjścia (dB)', 0, 24, 4)] },
    { id: 'limiter', name: 'Ogranicznik (limiter)', params: [n('ceil', 'Pułap (dB)', -20, 0, -1, { step: 0.1 }), n('boost', 'Wzmocnienie wejścia (dB)', 0, 24, 3)] },
    { id: 'invertpol', name: 'Odwróć polaryzację', params: [] }
  ] },
  { cat: 'Filtry i korekcja', audio: true, items: [
    { id: 'bass', name: 'Bas', params: [n('gain', 'Wzmocnienie (dB)', -20, 20, 6)] },
    { id: 'treble', name: 'Soprany', params: [n('gain', 'Wzmocnienie (dB)', -20, 20, 6)] },
    { id: 'eq3', name: 'Korektor 3-pasmowy', params: [n('lo', 'Niskie (dB)', -20, 20, 0), n('mid', 'Średnie (dB)', -20, 20, 0), n('hi', 'Wysokie (dB)', -20, 20, 0), n('mf', 'Częstotliwość średnich (Hz)', 200, 5000, 1000)] },
    { id: 'highpass', name: 'Filtr górnoprzepustowy', params: [n('freq', 'Częstotliwość (Hz)', 20, 4000, 120)] },
    { id: 'lowpass', name: 'Filtr dolnoprzepustowy', params: [n('freq', 'Częstotliwość (Hz)', 200, 20000, 4000)] },
    { id: 'bandpass', name: 'Filtr pasmowoprzepustowy', params: [n('freq', 'Częstotliwość (Hz)', 100, 8000, 1000), n('q', 'Dobroć Q', 0.1, 20, 1, { step: 0.1 })] },
    { id: 'notch', name: 'Filtr wycinający (notch)', params: [n('freq', 'Częstotliwość (Hz)', 40, 8000, 50), n('q', 'Dobroć Q', 0.5, 30, 10, { step: 0.1 })] },
    { id: 'telephone', name: 'Efekt telefonu / radia', params: [n('mix', 'Ilość', 0, 100, 100)] }
  ] },
  { cat: 'Opóźnienie i pogłos', audio: true, items: [
    { id: 'echo', name: 'Echo', params: [n('time', 'Opóźnienie (ms)', 20, 1500, 300), n('feedback', 'Sprzężenie', 0, 90, 35), n('mix', 'Miks', 0, 100, 35)] },
    { id: 'reverb', name: 'Pogłos (studio / hala)', params: [n('size', 'Wielkość pomieszczenia (s)', 0.2, 8, 2, { step: 0.1 }), n('decay', 'Wygaszanie', 1, 10, 3, { step: 0.1 }), n('mix', 'Miks', 0, 100, 30)] }
  ] },
  { cat: 'Modulacja i specjalne', audio: true, items: [
    { id: 'chorus', name: 'Chorus', params: [n('rate', 'Szybkość (Hz)', 0.1, 8, 1.2, { step: 0.1 }), n('depth', 'Głębokość (ms)', 0.5, 15, 4, { step: 0.5 }), n('mix', 'Miks', 0, 100, 50)] },
    { id: 'flanger', name: 'Flanger', params: [n('rate', 'Szybkość (Hz)', 0.05, 5, 0.3, { step: 0.05 }), n('depth', 'Głębokość (ms)', 0.5, 8, 2.5, { step: 0.5 }), n('fb', 'Sprzężenie', 0, 90, 50), n('mix', 'Miks', 0, 100, 50)] },
    { id: 'tremolo', name: 'Tremolo', params: [n('rate', 'Szybkość (Hz)', 0.5, 20, 5, { step: 0.1 }), n('depth', 'Głębokość', 0, 100, 60)] },
    { id: 'distortion', name: 'Przester', params: [n('amount', 'Ilość', 0, 100, 40), n('mix', 'Miks', 0, 100, 100)] },
    { id: 'bitcrush', name: 'Bitcrusher (8-bit)', params: [n('bits', 'Bity', 2, 16, 6, { step: 1 })] }
  ] },
  { cat: 'Kanały', audio: true, items: [
    { id: 'swapch', name: 'Zamień kanały L/P', params: [] },
    { id: 'fillleft', name: 'Wypełnij lewym kanałem', params: [] },
    { id: 'fillright', name: 'Wypełnij prawym kanałem', params: [] },
    { id: 'mono', name: 'Mono', params: [] }
  ] }
];
A.forEach(c => c.items.forEach(i => i.audio = true));
TZ.EFFECTS = V.concat(A);
TZ.fxDef = id => { for (const c of TZ.EFFECTS) for (const i of c.items) if (i.id === id) return i; return null; };

/* ---------- transitions ---------- */
TZ.TRANSITIONS = [
  { cat: 'Rozpuszczanie', items: [
    { id: 'cross', name: 'Przenikanie' }, { id: 'filmdis', name: 'Przenikanie filmowe' }, { id: 'additive', name: 'Rozpuszczanie addytywne' },
    { id: 'dipblack', name: 'Przejście przez czerń' }, { id: 'dipwhite', name: 'Przejście przez biel' }, { id: 'blurdis', name: 'Rozmyte przenikanie' }, { id: 'flash', name: 'Błysk' } ] },
  { cat: 'Przesunięcie', items: [
    { id: 'slide_l', name: 'Wsunięcie z prawej' }, { id: 'slide_r', name: 'Wsunięcie z lewej' }, { id: 'slide_u', name: 'Wsunięcie z dołu' }, { id: 'slide_d', name: 'Wsunięcie z góry' },
    { id: 'push_l', name: 'Wypchnięcie w lewo' }, { id: 'push_r', name: 'Wypchnięcie w prawo' }, { id: 'push_u', name: 'Wypchnięcie w górę' }, { id: 'push_d', name: 'Wypchnięcie w dół' },
    { id: 'whip', name: 'Szybka panorama (whip)' }, { id: 'split', name: 'Podział' }, { id: 'inset', name: 'Wstawka' } ] },
  { cat: 'Wymazanie', items: [
    { id: 'wipe', name: 'Wymazanie (lewo → prawo)' }, { id: 'wipe_r', name: 'Wymazanie (prawo → lewo)' }, { id: 'wipe_d', name: 'Wymazanie (góra → dół)' }, { id: 'wipe_u', name: 'Wymazanie (dół → góra)' },
    { id: 'barn', name: 'Drzwi stodoły' }, { id: 'clock', name: 'Wymazanie zegarowe' }, { id: 'blindsT', name: 'Żaluzje' }, { id: 'checkerT', name: 'Szachownica' },
    { id: 'blocksT', name: 'Losowe bloki' }, { id: 'band', name: 'Wymazanie paskowe' } ] },
  { cat: 'Przesłona', items: [{ id: 'iris', name: 'Przesłona okrągła' }, { id: 'irisbox', name: 'Przesłona kwadratowa' }, { id: 'irisdiamond', name: 'Przesłona rombowa' }] },
  { cat: 'Powiększenie', items: [{ id: 'zoom', name: 'Przybliżenie' }, { id: 'zoomout', name: 'Oddalenie' }, { id: 'crosszoom', name: 'Krzyżowe przybliżenie' }, { id: 'spin', name: 'Obrót z przybliżeniem' }] },
  { cat: 'Specjalne', items: [{ id: 'glitchT', name: 'Glitch' }, { id: 'lightleakT', name: 'Przeciek światła' }] },
  { cat: 'Przejścia audio', audio: true, items: [{ id: 'constpower', name: 'Stała moc', audio: true }, { id: 'constgain', name: 'Stałe wzmocnienie', audio: true }, { id: 'expfade', name: 'Zanikanie wykładnicze', audio: true }] }
];
TZ.trDef = id => { for (const c of TZ.TRANSITIONS) for (const i of c.items) if (i.id === id) return i; return null; };

/* ---------- presets (Ustawienia wstępne) ---------- */
const fx = (id, p) => { const d = TZ.fxDef(id); const o = {}; d.params.forEach(x => o[x.k] = x.def); return { uid: TZ.uid('fx'), id, p: Object.assign(o, p || {}), enabled: true, kf: {} }; };
const W = () => TZ.state.seq.width, Hh = () => TZ.state.seq.height;
TZ.PRESETS = [
  { cat: 'Wejścia i wyjścia', items: [
    { id: 'p_fadein', name: 'Pojawienie (fade in)', apply: c => { c.kf.opacity = [{ t: 0, v: 0 }, { t: Math.min(1, c.dur / 2), v: 100 }]; } },
    { id: 'p_fadeout', name: 'Wygaszenie (fade out)', apply: c => { c.kf.opacity = [{ t: Math.max(0, c.dur - 1), v: 100 }, { t: c.dur, v: 0 }]; } },
    { id: 'p_blurin', name: 'Wejście z rozmyciem', apply: c => { const f = fx('blur', { amount: 60 }); f.kf.amount = [{ t: 0, v: 80 }, { t: Math.min(0.8, c.dur / 2), v: 0 }]; c.effects.push(f); } },
    { id: 'p_blurout', name: 'Wyjście z rozmyciem', apply: c => { const f = fx('blur', { amount: 0 }); f.kf.amount = [{ t: Math.max(0, c.dur - 0.8), v: 0 }, { t: c.dur, v: 80 }]; c.effects.push(f); } },
    { id: 'p_popin', name: 'Wyskoczenie (pop-in)', apply: c => { c.kf.scale = [{ t: 0, v: 0, ease: 'ease' }, { t: 0.25, v: c.props.scale * 1.1, ease: 'ease' }, { t: 0.4, v: c.props.scale }]; } },
    { id: 'p_glitchin', name: 'Glitch na wejściu', apply: c => { const f = fx('glitch', { amount: 100 }); f.kf.amount = [{ t: 0, v: 100 }, { t: Math.min(0.7, c.dur / 2), v: 0 }]; c.effects.push(f); } },
    { id: 'p_wipein', name: 'Odsłonięcie liniowe', apply: c => { const f = fx('linwipe', { c: 100 }); f.kf.c = [{ t: 0, v: 100, ease: 'ease' }, { t: Math.min(1, c.dur / 2), v: 0 }]; c.effects.push(f); } }
  ] },
  { cat: 'Ruch kamery (Ken Burns)', items: [
    { id: 'p_zoomin', name: 'Powolne przybliżenie', apply: c => { c.kf.scale = [{ t: 0, v: c.props.scale }, { t: c.dur, v: c.props.scale * 1.2 }]; } },
    { id: 'p_zoomout', name: 'Powolne oddalenie', apply: c => { c.kf.scale = [{ t: 0, v: c.props.scale * 1.2 }, { t: c.dur, v: c.props.scale }]; } },
    { id: 'p_panl', name: 'Panorama w lewo', apply: c => { c.props.scale = 120; c.kf.posX = [{ t: 0, v: W() / 2 + W() * 0.08 }, { t: c.dur, v: W() / 2 - W() * 0.08 }]; } },
    { id: 'p_panr', name: 'Panorama w prawo', apply: c => { c.props.scale = 120; c.kf.posX = [{ t: 0, v: W() / 2 - W() * 0.08 }, { t: c.dur, v: W() / 2 + W() * 0.08 }]; } },
    { id: 'p_shake', name: 'Trzęsienie kamery', apply: c => { c.effects.push(fx('shake', { amount: 45, sp: 1.5 })); c.props.scale = Math.max(c.props.scale, 108); } }
  ] },
  { cat: 'Obraz w obrazie', items: [
    { id: 'p_pip_tr', name: 'Obraz w obrazie – prawy górny', apply: c => { c.props.scale = 33; c.props.posX = W() * 0.78; c.props.posY = Hh() * 0.22; c.effects.push(fx('rounded', { r: 24 }), fx('shadow', { d: 10, soft: 15 })); } },
    { id: 'p_pip_bl', name: 'Obraz w obrazie – lewy dolny', apply: c => { c.props.scale = 33; c.props.posX = W() * 0.22; c.props.posY = Hh() * 0.78; c.effects.push(fx('rounded', { r: 24 }), fx('shadow', { d: 10, soft: 15 })); } },
    { id: 'p_split_l', name: 'Podzielony ekran – lewa połowa', apply: c => { c.props.posX = W() * 0.25; c.props.cropL = 25; c.props.cropR = 25; } },
    { id: 'p_split_r', name: 'Podzielony ekran – prawa połowa', apply: c => { c.props.posX = W() * 0.75; c.props.cropL = 25; c.props.cropR = 25; } }
  ] },
  { cat: 'Style', items: [
    { id: 'p_cine', name: 'Kinowy wygląd (pasy + kolor)', apply: c => { c.effects.push(fx('letterbox', { r: 0 })); c.lumetri.look = 'cine'; } },
    { id: 'p_vhs', name: 'Retro VHS', apply: c => { c.effects.push(fx('vhs', { amount: 70 }), fx('scanlines', { i: 20 })); } },
    { id: 'p_oldfilm', name: 'Stary film', apply: c => { c.effects.push(fx('oldfilm', { amount: 80 }), fx('dust', { amount: 50 })); } },
    { id: 'p_dream', name: 'Senna poświata', apply: c => { c.effects.push(fx('glow', { th: 40, radius: 40, amount: 70 })); c.lumetri.faded = 15; } },
    { id: 'p_comic', name: 'Komiks', apply: c => { c.effects.push(fx('cartoon', {}), fx('halftone', { s: 6 })); } },
    { id: 'p_music', name: 'Teledysk (RGB + glitch)', apply: c => { c.effects.push(fx('rgbsplit', { amount: 6 }), fx('glitch', { amount: 30 })); } }
  ] }
];
TZ.presetDef = id => { for (const c of TZ.PRESETS) for (const i of c.items) if (i.id === id) return i; return null; };
TZ.newEffect = fx;

/* ---------- keyframe evaluation helpers ---------- */
TZ.kfEval = (kf, lt, fallback) => {
  if (!kf || !kf.length) return fallback;
  if (lt <= kf[0].t) return kf[0].v;
  const last = kf[kf.length - 1];
  if (lt >= last.t) return last.v;
  for (let i = 0; i < kf.length - 1; i++) {
    const a = kf[i], b = kf[i + 1];
    if (lt >= a.t && lt <= b.t) {
      let p = (lt - a.t) / (b.t - a.t || 1);
      if (a.ease === 'ease') p = p * p * (3 - 2 * p); else if (a.ease === 'in') p = p * p; else if (a.ease === 'out') p = 1 - (1 - p) * (1 - p); else if (a.ease === 'hold') p = 0;
      return typeof a.v === 'number' ? a.v + (b.v - a.v) * p : a.v;
    }
  }
  return fallback;
};
TZ.fxVal = (f, k, lt) => (f.kf && f.kf[k] && f.kf[k].length) ? TZ.kfEval(f.kf[k], lt, f.p[k]) : f.p[k];
TZ.fxParams = (f, lt) => { const d = TZ.fxDef(f.id); const o = {}; if (d) d.params.forEach(p => o[p.k] = TZ.fxVal(f, p.k, lt)); return o; };
})();
