import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from 'react';

// ─────────────────────────────────────────────────────────────
// CSS INJECTION (keyframes + base reset)
// ─────────────────────────────────────────────────────────────
const CSS = `
  @keyframes gti-pulse   { 0%,100%{opacity:1} 50%{opacity:0.25} }
  @keyframes gti-dropin  { from{opacity:0;transform:translateY(-14px)} to{opacity:1;transform:translateY(0)} }
  @keyframes gti-popout  { 0%{opacity:1;transform:scale(1)} 100%{opacity:0;transform:scale(1.4)} }
  @keyframes gti-ring    { 0%{r:8;opacity:0.7} 100%{r:22;opacity:0} }
  .gti-dropin  { animation: gti-dropin 0.35s ease forwards; }
  .gti-popout  { animation: gti-popout 0.5s ease forwards; }
`;

function InjectCSS() {
  useEffect(() => {
    if (document.getElementById('gti-css')) return;
    const el = document.createElement('style');
    el.id = 'gti-css';
    el.textContent = CSS;
    document.head.appendChild(el);
  }, []);
  return null;
}

// ─────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────
const SPEED_CFG = {
  slow:   { cycle: 45000, label: 'Slow'   },
  medium: { cycle: 25000, label: 'Medium' },
  fast:   { cycle: 12000, label: 'Fast'   },
};

// SVG viewBox for cluster canvas
const VB_W = 480, VB_H = 340;

const CLUSTER_DEFS = [
  { id:'apac-sales-fl',   label:'APAC Sales\nFrontline',    loc:'APAC',     lvl:'Frontline', foc:'Sales',     cx:105, cy: 90 },
  { id:'apac-sales-mgr',  label:'APAC Sales\nManager',      loc:'APAC',     lvl:'Manager',   foc:'Sales',     cx:295, cy: 70 },
  { id:'emea-client-sr',  label:'EMEA Client\nSenior',      loc:'EMEA',     lvl:'Senior',    foc:'Client',    cx:395, cy:185 },
  { id:'amer-talent-mgr', label:'Americas Talent\nManager', loc:'Americas', lvl:'Manager',   foc:'Talent',    cx:215, cy:265 },
  { id:'global-strat-sr', label:'Global Strategy\nSenior',  loc:'APAC',     lvl:'Senior',    foc:'Strategy',  cx: 85, cy:245 },
  { id:'apac-ops-fl',     label:'APAC Ops\nFrontline',      loc:'APAC',     lvl:'Frontline', foc:'Sales',     cx:365, cy:295 },
];

const TILE_DEFS = [
  { id:'apac-accel',  region:'APAC',   topic:'Sales Accelerators', confidence:71, dots:[0.20,0.50,0.70,0.80,0.60,0.40,0.90,0.65] },
  { id:'apac-risk',   region:'APAC',   topic:'Sales Risk',          confidence:58, dots:[0.30,0.60,0.20,0.70,0.50,0.80,0.40,0.35] },
  { id:'emea-health', region:'EMEA',   topic:'Client Health',       confidence:82, dots:[0.60,0.70,0.80,0.90,0.70,0.80,0.60,0.75] },
  { id:'global-tal',  region:'Global', topic:'Talent Signal',       confidence:44, dots:[0.30,0.20,0.70,0.10,0.80,0.40,0.50,0.25] },
];

const QUESTIONS_POOL = [
  { text:'Why is APAC pipeline conversion dropping in enterprise?', src:'CSO-generated',      tc:'apac-sales-mgr'  },
  { text:"What's blocking deals in Singapore right now?",           src:'System-generated',   tc:'apac-sales-fl'   },
  { text:'How accurate are Q2 forecasts in your region?',          src:'CSO-generated',       tc:'apac-sales-mgr'  },
  { text:'What competitor are you losing to most often?',          src:'Employee-generated',  tc:'emea-client-sr'  },
  { text:"What's one thing slowing your team down?",               src:'System-generated',    tc:'apac-ops-fl'     },
  { text:'What deals are most at risk this quarter?',              src:'CSO-generated',       tc:'apac-sales-fl'   },
  { text:'Where is EMEA talent pressure highest?',                 src:'System-generated',    tc:'amer-talent-mgr' },
  { text:'What signals should CSO watch in APAC now?',             src:'CSO-generated',       tc:'global-strat-sr' },
];

const EMP_REQUESTS = [
  { text:'Need latest competitive pricing deck for APAC',    route:'answer' },
  { text:'Who knows about procurement delays in Korea?',     route:'sme'    },
  { text:'Looking for Q1 win/loss analysis',                route:'answer' },
  { text:'New client onboarding template — anyone?',         route:'queue'  },
  { text:'Best practices for enterprise deal structuring?',  route:'sme'    },
  { text:'Recent intel on competitor pricing in EMEA?',     route:'queue'  },
];

const ROUTE_LABELS = {
  answer: 'Answered from knowledge base',
  sme:    'Routed to SME',
  queue:  'Added to question queue',
};

// ─────────────────────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────────────────────
let _uid = 0;
const uid = () => `g${++_uid}`;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const rng = (n = 1) => (Math.random() - 0.5) * n;

function cubicBezierPt(p0, cp1, cp2, p1, t) {
  const mt = 1 - t;
  return {
    x: mt*mt*mt*p0.x + 3*mt*mt*t*cp1.x + 3*mt*t*t*cp2.x + t*t*t*p1.x,
    y: mt*mt*mt*p0.y + 3*mt*mt*t*cp1.y + 3*mt*t*t*cp2.y + t*t*t*p1.y,
  };
}

function matchesFilter(item, filters) {
  if (filters.location !== 'All' && item.loc !== filters.location) return false;
  if (filters.level    !== 'All' && item.lvl !== filters.level)    return false;
  if (filters.focus    !== 'All' && item.foc !== filters.focus)    return false;
  return true;
}

function initDots() {
  return CLUSTER_DEFS.flatMap((c, ci) =>
    Array.from({ length: 8 }, (_, i) => ({
      id:  `d${ci}${i}`,
      cid: c.id,
      ox:  rng(56), oy: rng(44),          // fixed offset from cluster center
      x:   c.cx + rng(56), y: c.cy + rng(44),
      vx:  0, vy: 0,
      alpha: 0.45 + Math.random() * 0.55,
      loc: c.loc, lvl: c.lvl, foc: c.foc,
    }))
  );
}

function initQuestions() {
  return QUESTIONS_POOL.slice(0, 5).map((q, i) => ({ ...q, id: uid(), rank: i + 1 }));
}

function initTiles() {
  return TILE_DEFS.map(t => ({
    ...t, flagged: false, pulsing: false, trend: null, lastUpdate: 'just now'
  }));
}

// ─────────────────────────────────────────────────────────────
// TOP BAR
// ─────────────────────────────────────────────────────────────
function TopBar({ speed, onSpeed }) {
  return (
    <div style={{
      display:'flex', alignItems:'center', justifyContent:'space-between',
      padding:'0 22px', height:'46px', borderBottom:'1px solid #e5e7eb',
      background:'#fff', flexShrink:0,
    }}>
      <div style={{ display:'flex', alignItems:'baseline', gap:'12px' }}>
        <span style={{
          fontSize:'10.5px', fontWeight:700, letterSpacing:'0.16em',
          textTransform:'uppercase', color:'#111',
        }}>
          Ground Truth Intelligence
        </span>
        <span style={{ fontSize:'10px', color:'#b0b7c3', letterSpacing:'0.04em' }}>
          CSO Intelligence Layer
        </span>
      </div>

      <div style={{ display:'flex', gap:'5px', alignItems:'center' }}>
        {(['slow','medium','fast']).map(s => (
          <button key={s} onClick={() => onSpeed(s)} style={{
            padding:'3px 11px', fontSize:'10px', borderRadius:'3px',
            cursor:'pointer', fontFamily:'inherit', letterSpacing:'0.04em',
            border:'1px solid #111',
            background: speed === s ? '#111' : '#fff',
            color:       speed === s ? '#fff' : '#111',
            transition: 'background 0.15s, color 0.15s',
          }}>
            {SPEED_CFG[s].label}
          </button>
        ))}
        <div style={{
          marginLeft:'14px', display:'flex', alignItems:'center',
          gap:'5px', fontSize:'10px', color:'#6b7280',
        }}>
          <div style={{
            width:'6px', height:'6px', borderRadius:'50%', background:'#22c55e',
            animation:'gti-pulse 2s ease-in-out infinite',
          }}/>
          Live
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// LEFT PANEL — KNOWLEDGE EXCHANGE SYSTEM
// ─────────────────────────────────────────────────────────────
function DecisionRouter({ activeRoute }) {
  const W = 196, H = 190;
  const routerY = 62;
  const branches = [
    { id:'answer', x:36,  label:['Answer', 'Directly'] },
    { id:'sme',    x:98,  label:['Connect', 'with SME'] },
    { id:'queue',  x:160, label:['Add to', 'Queue'] },
  ];

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display:'block', overflow:'visible' }}>
      {/* Incoming arrow */}
      <line x1={98} y1={4} x2={98} y2={routerY - 9}
        stroke="#d1d5db" strokeWidth="1.5" markerEnd="url(#arr)" />

      {/* Router bar */}
      <rect x={14} y={routerY - 9} width={168} height={18}
        rx={3} fill="#f9fafb" stroke="#d1d5db" strokeWidth="1" />
      <text x={98} y={routerY + 4} textAnchor="middle" fontSize="6.5"
        fill="#9ca3af" fontFamily="inherit" fontWeight="600" letterSpacing="0.05em">
        DECISION ROUTER
      </text>

      {/* Branch lines + boxes */}
      {branches.map(b => {
        const active = activeRoute === b.id;
        return (
          <g key={b.id}>
            <line x1={98} y1={routerY + 9} x2={b.x} y2={H - 40}
              stroke={active ? '#111' : '#e5e7eb'}
              strokeWidth={active ? 1.5 : 1}
              style={{ transition:'stroke 0.25s, stroke-width 0.25s' }}
            />
            <rect x={b.x - 26} y={H - 40} width={52} height={28} rx={3}
              fill={active ? '#111' : '#fff'}
              stroke={active ? '#111' : '#e5e7eb'}
              strokeWidth={active ? 0 : 1}
              style={{ transition:'fill 0.25s' }}
            />
            {b.label.map((line, li) => (
              <text key={li} x={b.x} y={H - 40 + 10 + li * 9}
                textAnchor="middle" fontSize="6"
                fill={active ? '#fff' : '#6b7280'} fontFamily="inherit"
                style={{ transition:'fill 0.25s' }}>
                {line}
              </text>
            ))}
          </g>
        );
      })}

      {/* Route label */}
      {activeRoute && (
        <text x={98} y={H - 4} textAnchor="middle" fontSize="6"
          fill="#9ca3af" fontFamily="inherit" fontStyle="italic">
          {ROUTE_LABELS[activeRoute]}
        </text>
      )}

      <defs>
        <marker id="arr" markerWidth="5" markerHeight="5" refX="3" refY="2.5" orient="auto">
          <path d="M0,0 L0,5 L5,2.5z" fill="#d1d5db"/>
        </marker>
      </defs>
    </svg>
  );
}

function LeftPanel({ requests, activeRoute }) {
  return (
    <div style={{
      width:'210px', flexShrink:0, display:'flex', flexDirection:'column',
      borderRight:'1px solid #e5e7eb', background:'#fff', overflow:'hidden',
    }}>
      <div style={{ padding:'12px 14px 8px', borderBottom:'1px solid #f3f4f6', flexShrink:0 }}>
        <div style={{
          fontSize:'8.5px', fontWeight:700, letterSpacing:'0.14em',
          textTransform:'uppercase', color:'#9ca3af',
        }}>
          Knowledge System
        </div>
      </div>

      {/* Incoming request feed */}
      <div style={{ padding:'8px 10px', flexShrink:0, minHeight:'80px' }}>
        {requests.map(r => (
          <div key={r.id} className="gti-dropin" style={{
            display:'flex', alignItems:'center', gap:'6px',
            padding:'5px 8px', marginBottom:'4px',
            border:'1px solid #e5e7eb', borderRadius:'6px',
            background:'#fff', fontSize:'9.5px', color:'#374151',
            opacity: r.fading ? 0 : 1,
            transition:'opacity 0.6s ease',
          }}>
            <div style={{
              width:'4px', height:'4px', borderRadius:'50%',
              background:'#374151', flexShrink:0,
            }}/>
            <span style={{
              flex:1, overflow:'hidden', textOverflow:'ellipsis',
              whiteSpace:'nowrap', lineHeight:1.3,
            }}>
              {r.text}
            </span>
          </div>
        ))}
        {requests.length === 0 && (
          <div style={{ fontSize:'9px', color:'#d1d5db', padding:'6px 4px', fontStyle:'italic' }}>
            Awaiting requests…
          </div>
        )}
      </div>

      {/* Decision router diagram */}
      <div style={{ flex:1, padding:'0 6px 8px', display:'flex', flexDirection:'column', justifyContent:'flex-start' }}>
        <DecisionRouter activeRoute={activeRoute} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// CENTER PANEL — EMPLOYEE CLUSTERS
// ─────────────────────────────────────────────────────────────
function FilterBar({ filters, onChange }) {
  const groups = [
    { key:'location', label:'Location', opts:['All','APAC','EMEA','Americas'] },
    { key:'level',    label:'Level',    opts:['All','Frontline','Manager','Senior'] },
    { key:'focus',    label:'Focus',    opts:['All','Sales','Client','Talent','Strategy'] },
  ];

  return (
    <div style={{ padding:'10px 14px 8px', flexShrink:0 }}>
      <div style={{
        fontSize:'8.5px', fontWeight:700, letterSpacing:'0.14em',
        textTransform:'uppercase', color:'#9ca3af', marginBottom:'8px',
      }}>
        Employee Population
      </div>
      {groups.map(grp => (
        <div key={grp.key} style={{
          display:'flex', alignItems:'center', gap:'3px',
          marginBottom:'4px', flexWrap:'wrap',
        }}>
          <span style={{
            fontSize:'8.5px', color:'#b0b7c3', width:'46px', flexShrink:0,
          }}>
            {grp.label}:
          </span>
          {grp.opts.map(opt => (
            <button key={opt} onClick={() => onChange(grp.key, opt)} style={{
              padding:'2px 7px', fontSize:'8.5px', borderRadius:'10px',
              cursor:'pointer', fontFamily:'inherit',
              border: filters[grp.key] === opt ? '1px solid #111' : '1px solid #e5e7eb',
              background: filters[grp.key] === opt ? '#111' : '#fff',
              color:       filters[grp.key] === opt ? '#fff' : '#374151',
              transition: 'all 0.15s',
            }}>
              {opt}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

function ClusterCanvas({ dots, filters, svgRef, pulses }) {
  // Cluster bounding ellipses
  const bounds = useMemo(() => {
    const b = {};
    CLUSTER_DEFS.forEach(c => {
      const cd = dots.filter(d => d.cid === c.id);
      if (!cd.length) { b[c.id] = { cx:c.cx, cy:c.cy, rx:26, ry:22 }; return; }
      const xs = cd.map(d => d.x), ys = cd.map(d => d.y);
      const minX = Math.min(...xs), maxX = Math.max(...xs);
      const minY = Math.min(...ys), maxY = Math.max(...ys);
      b[c.id] = {
        cx: (minX + maxX) / 2, cy: (minY + maxY) / 2,
        rx: Math.max(24, (maxX - minX) / 2 + 16),
        ry: Math.max(20, (maxY - minY) / 2 + 14),
      };
    });
    return b;
  }, [dots]);

  return (
    <svg
      ref={svgRef}
      width="100%" height="100%"
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      preserveAspectRatio="xMidYMid meet"
      style={{ display:'block' }}
    >
      {/* Cluster ovals */}
      {CLUSTER_DEFS.map(c => {
        const b = bounds[c.id];
        const active = matchesFilter({ loc:c.loc, lvl:c.lvl, foc:c.foc }, filters);
        return (
          <ellipse key={`oval-${c.id}`}
            cx={b.cx} cy={b.cy} rx={b.rx} ry={b.ry}
            fill="none" stroke="#d1d5db"
            strokeWidth="1" strokeDasharray="5 3"
            opacity={active ? 1 : 0.18}
            style={{ transition:'opacity 0.5s' }}
          />
        );
      })}

      {/* Dots */}
      {dots.map(d => {
        const active = matchesFilter(d, filters);
        return (
          <circle key={d.id}
            cx={d.x} cy={d.y} r={3}
            fill="#374151"
            opacity={active ? d.alpha : 0.08}
            style={{ transition:'opacity 0.45s' }}
          />
        );
      })}

      {/* Cluster labels */}
      {CLUSTER_DEFS.map(c => {
        const b = bounds[c.id];
        const active = matchesFilter({ loc:c.loc, lvl:c.lvl, foc:c.foc }, filters);
        const lines = c.label.split('\n');
        return (
          <g key={`lbl-${c.id}`}
            opacity={active ? 1 : 0.15}
            style={{ transition:'opacity 0.45s' }}
          >
            {lines.map((ln, li) => (
              <text key={li}
                x={b.cx} y={b.cy + b.ry + 11 + li * 9}
                textAnchor="middle" fontSize="7.5" fill="#9ca3af"
                fontFamily="-apple-system,BlinkMacSystemFont,'Inter',sans-serif"
              >
                {ln}
              </text>
            ))}
          </g>
        );
      })}

      {/* Absorption pulse rings */}
      {pulses.map(p => (
        <circle key={p.id}
          cx={p.cx} cy={p.cy}
          r={p.r} fill="none"
          stroke="#374151" strokeWidth="1"
          opacity={p.alpha}
          style={{ pointerEvents:'none' }}
        />
      ))}
    </svg>
  );
}

function CenterPanel({ dots, filters, onFilterChange, svgRef, pulses }) {
  return (
    <div style={{
      flex:1, display:'flex', flexDirection:'column',
      background:'#fff', overflow:'hidden', minWidth:0,
    }}>
      <FilterBar filters={filters} onChange={onFilterChange} />
      <div style={{ flex:1, overflow:'hidden', position:'relative' }}>
        <ClusterCanvas dots={dots} filters={filters} svgRef={svgRef} pulses={pulses} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// RIGHT PANEL — SIGNAL TILES + QUESTION QUEUE
// ─────────────────────────────────────────────────────────────
function SignalTile({ tile, tileRef }) {
  const [disp, setDisp] = useState(tile.confidence);

  useEffect(() => {
    let c = disp;
    const target = tile.confidence;
    if (c === target) return;
    const step = c < target ? 1 : -1;
    const iv = setInterval(() => {
      c += step;
      setDisp(c);
      if (c === target) clearInterval(iv);
    }, 35);
    return () => clearInterval(iv);
  }, [tile.confidence]); // eslint-disable-line

  return (
    <div ref={tileRef} style={{
      border: tile.pulsing ? '1.5px solid #111' : '1px solid #e5e7eb',
      borderRadius:'6px', padding:'10px',
      background:'#fff', minWidth:0,
      transition:'border-color 0.3s, border-width 0.2s',
    }}>
      <div style={{
        fontSize:'7.5px', color:'#b0b7c3', fontWeight:600,
        textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:'2px',
      }}>
        {tile.region}
      </div>
      <div style={{
        fontSize:'9.5px', fontWeight:600, color:'#111',
        marginBottom:'7px', lineHeight:1.25, display:'flex',
        alignItems:'center', gap:'3px',
      }}>
        {tile.topic}
        {tile.flagged && (
          <span style={{ color:'#ef4444', fontSize:'10px', lineHeight:1 }}>⚑</span>
        )}
      </div>

      {/* Dot plot — horizontal axis */}
      <div style={{
        position:'relative', height:'14px',
        background:'#f9fafb', borderRadius:'3px',
        marginBottom:'7px', overflow:'visible',
      }}>
        <div style={{
          position:'absolute', top:'50%', left:'4px', right:'4px',
          height:'1px', background:'#e5e7eb', transform:'translateY(-50%)',
        }}/>
        {tile.dots.map((v, i) => {
          const isNew = i === tile.dots.length - 1;
          return (
            <div key={i} style={{
              position:'absolute',
              left:`calc(${v * 88}% + 4px)`,
              top:'50%', transform:'translate(-50%, -50%)',
              width: isNew ? '6px' : '5px',
              height: isNew ? '6px' : '5px',
              borderRadius:'50%',
              background: isNew ? '#111' : '#9ca3af',
              transition: isNew ? 'left 0.6s ease' : 'none',
              zIndex: isNew ? 2 : 1,
            }}/>
          );
        })}
      </div>

      <div style={{
        display:'flex', alignItems:'center', justifyContent:'space-between',
      }}>
        <div style={{ fontSize:'11px', fontWeight:700, color:'#111' }}>
          {disp}%
          {tile.trend === 'up'   && <span style={{ fontSize:'8px', color:'#9ca3af', marginLeft:'2px' }}>↑</span>}
          {tile.trend === 'down' && <span style={{ fontSize:'8px', color:'#9ca3af', marginLeft:'2px' }}>↓</span>}
        </div>
        <div style={{ fontSize:'7.5px', color:'#d1d5db' }}>{tile.lastUpdate}</div>
      </div>
    </div>
  );
}

function QuestionItem({ question, rank }) {
  const borderStyle =
    question.src === 'CSO-generated'      ? '1.5px solid #111'          :
    question.src === 'Employee-generated' ? '1px dashed #9ca3af'        :
                                            '1px solid #e5e7eb';
  const fw = question.src === 'CSO-generated' ? 600 : 400;

  return (
    <div className="gti-dropin" style={{
      display:'flex', gap:'6px', alignItems:'flex-start',
      padding:'6px 8px', marginBottom:'4px',
      border: borderStyle, borderRadius:'5px',
      background:'#fff', fontSize:'9.5px',
      opacity: question.dispatching ? 0 : 1,
      transform: question.dispatching ? 'translateX(-16px)' : 'translateX(0)',
      transition:'opacity 0.4s ease, transform 0.4s ease',
    }}>
      <span style={{
        color:'#d1d5db', fontWeight:700, fontSize:'9px',
        flexShrink:0, width:'13px', textAlign:'right', paddingTop:'1px',
      }}>
        {rank}
      </span>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{
          overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
          color:'#111', fontWeight:fw, lineHeight:1.35, marginBottom:'2px',
        }}>
          {question.text}
        </div>
        <div style={{
          fontSize:'7.5px', color:'#b0b7c3',
          textTransform:'uppercase', letterSpacing:'0.06em',
        }}>
          {question.src}
        </div>
        <div style={{
          height:'2px', background:'#f3f4f6', borderRadius:'1px', marginTop:'4px',
        }}>
          <div style={{
            height:'100%', borderRadius:'1px',
            background: rank === 1 ? '#111' : rank <= 3 ? '#6b7280' : '#d1d5db',
            width:`${Math.max(15, 100 - rank * 13)}%`,
            transition:'width 0.5s',
          }}/>
        </div>
      </div>
    </div>
  );
}

function RightPanel({ tiles, questions, tileRefs, queueRef }) {
  return (
    <div style={{
      width:'255px', flexShrink:0, display:'flex', flexDirection:'column',
      borderLeft:'1px solid #e5e7eb', background:'#fff', overflow:'hidden',
    }}>
      {/* Signal dashboard */}
      <div style={{ flexShrink:0, borderBottom:'1px solid #e5e7eb' }}>
        <div style={{ padding:'12px 14px 8px' }}>
          <div style={{
            fontSize:'8.5px', fontWeight:700, letterSpacing:'0.14em',
            textTransform:'uppercase', color:'#9ca3af',
          }}>
            CSO Signal Dashboard
          </div>
        </div>
        <div style={{
          display:'grid', gridTemplateColumns:'1fr 1fr',
          gap:'7px', padding:'0 10px 10px',
        }}>
          {tiles.map((tile, i) => (
            <SignalTile
              key={tile.id}
              tile={tile}
              tileRef={el => { if (tileRefs) tileRefs.current[i] = el; }}
            />
          ))}
        </div>
      </div>

      {/* Question queue */}
      <div ref={queueRef} style={{
        flex:1, display:'flex', flexDirection:'column', overflow:'hidden',
      }}>
        <div style={{ padding:'10px 14px 6px', flexShrink:0 }}>
          <div style={{
            display:'flex', alignItems:'center', justifyContent:'space-between',
          }}>
            <div style={{
              fontSize:'8.5px', fontWeight:700, letterSpacing:'0.14em',
              textTransform:'uppercase', color:'#9ca3af',
            }}>
              Question Queue
            </div>
            <div style={{
              background:'#111', color:'#fff', fontSize:'8.5px',
              padding:'1px 7px', borderRadius:'10px', fontWeight:600,
            }}>
              {questions.length} queued
            </div>
          </div>
        </div>
        <div style={{ flex:1, overflowY:'auto', padding:'0 8px 8px' }}>
          {questions.map((q, i) => (
            <QuestionItem key={q.id} question={q} rank={i + 1} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// SVG OVERLAY — flying objects
// ─────────────────────────────────────────────────────────────
function SVGOverlay({ flyingObjects }) {
  return (
    <svg style={{
      position:'fixed', top:0, left:0,
      width:'100%', height:'100%',
      pointerEvents:'none', zIndex:200,
      overflow:'visible',
    }}>
      {flyingObjects.map(obj => {
        const fill =
          obj.color === 'black'    ? '#111'    :
          obj.color === 'darkgray' ? '#6b7280' :
          obj.color === 'white'    ? '#fff'    : '#e5e7eb';
        const stroke = obj.color === 'white' ? '#111' : 'none';

        return (
          <g key={obj.id} transform={`translate(${obj.x.toFixed(1)},${obj.y.toFixed(1)})`}>
            <rect
              x="-5" y="-5" width="10" height="10" rx="1.5"
              fill={fill}
              stroke={stroke}
              strokeWidth={stroke !== 'none' ? '1' : '0'}
            />
            {obj.label && obj.progress < 0.18 && (
              <text x="9" y="3.5" fontSize="7" fill="#6b7280"
                fontFamily="-apple-system,BlinkMacSystemFont,'Inter',sans-serif">
                {obj.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────
// ROOT — GROUND TRUTH DEMO
// ─────────────────────────────────────────────────────────────
export default function GroundTruthDemo() {
  // ── UI State ──────────────────────────────────────────────
  const [speed, setSpeed]         = useState('medium');
  const [filters, setFilters]     = useState({ location:'All', level:'All', focus:'All' });
  const [dots, setDots]           = useState(initDots);
  const [tiles, setTiles]         = useState(initTiles);
  const [questions, setQuestions] = useState(initQuestions);
  const [leftRequests, setLeftR]  = useState([]);
  const [activeRoute, setActiveRoute] = useState(null);
  const [flyingObjects, setFlying]    = useState([]);
  const [pulses, setPulses]           = useState([]);

  // ── Refs (mutable, not triggering re-renders) ─────────────
  const dotsRef      = useRef(initDots());
  const flyingRef    = useRef([]);
  const pulsesRef    = useRef([]);
  const rafRef       = useRef(null);
  const lastTsRef    = useRef(null);
  const frameRef     = useRef(0);
  const cycleRef     = useRef({ elapsed:0, count:0 });
  const stepsRef     = useRef({});
  const svgRef       = useRef(null);    // SVG in CenterPanel
  const tileRefs     = useRef([]);
  const queueRef     = useRef(null);

  // Mirror state into refs so rAF callbacks are stable
  const speedRef     = useRef(speed);
  const filtersRef   = useRef(filters);
  const tilesRef     = useRef(tiles);
  const questionsRef = useRef(questions);

  useEffect(() => { speedRef.current = speed; },     [speed]);
  useEffect(() => { filtersRef.current = filters; }, [filters]);
  useEffect(() => { tilesRef.current = tiles; },     [tiles]);
  useEffect(() => { questionsRef.current = questions; }, [questions]);

  // ── Coordinate helpers ────────────────────────────────────
  const svgToScreen = useCallback((vx, vy) => {
    const el = svgRef.current;
    if (!el) return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    const rect = el.getBoundingClientRect();
    const scaleX = rect.width  / VB_W;
    const scaleY = rect.height / VB_H;
    const scale  = Math.min(scaleX, scaleY);
    const offX   = (rect.width  - VB_W * scale) / 2;
    const offY   = (rect.height - VB_H * scale) / 2;
    return {
      x: rect.left + offX + vx * scale,
      y: rect.top  + offY + vy * scale,
    };
  }, []);

  const clusterScreen = useCallback((cid) => {
    const c = CLUSTER_DEFS.find(x => x.id === cid);
    if (!c) return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    return svgToScreen(c.cx, c.cy);
  }, [svgToScreen]);

  const queueScreen = useCallback(() => {
    const el = queueRef.current;
    if (!el) return { x: window.innerWidth - 127, y: window.innerHeight * 0.68 };
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + 36 };
  }, []);

  const tileScreen = useCallback((idx) => {
    const el = tileRefs.current[idx];
    if (!el) return { x: window.innerWidth - 127, y: window.innerHeight * 0.2 + idx * 50 };
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, []);

  // ── Launch a flying square ─────────────────────────────────
  const launch = useCallback((from, to, opts = {}) => {
    const { color='black', label='', onArrive, duration=1800, type='question' } = opts;
    const dx = to.x - from.x, dy = to.y - from.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    // Arc perpendicular offset
    const px = -dy / dist * dist * 0.28;
    const py =  dx / dist * dist * 0.28;
    const obj = {
      id:   uid(),
      type, color, label,
      from, to,
      cp1:  { x: from.x + dx * 0.3 + px, y: from.y + dy * 0.3 + py },
      cp2:  { x: from.x + dx * 0.7 + px * 0.4, y: from.y + dy * 0.7 + py * 0.4 },
      progress: 0,
      spd:  1 / duration,
      x: from.x, y: from.y,
      onArrive,
    };
    flyingRef.current = [...flyingRef.current, obj];
  }, []);

  // ── Trigger an absorption pulse at a cluster ───────────────
  const pulse = useCallback((cid) => {
    const c = CLUSTER_DEFS.find(x => x.id === cid);
    if (!c) return;
    const id = uid();
    pulsesRef.current = [...pulsesRef.current, { id, cx:c.cx, cy:c.cy, r:8, alpha:0.7 }];
  }, []);

  // ── Cycle step functions (stable, use refs for mutable data)
  const stepGenQuestion = useCallback(() => {
    const q = QUESTIONS_POOL[Math.floor(Math.random() * QUESTIONS_POOL.length)];
    setQuestions(prev => {
      const next = [{ ...q, id:uid(), rank:1 }, ...prev]
        .slice(0, 7)
        .map((x, i) => ({ ...x, rank: i + 1 }));
      return next;
    });
  }, []);

  const stepDispatch = useCallback(() => {
    const qs = questionsRef.current;
    if (!qs.length) return;
    const q = qs[0];
    const from = queueScreen();
    const to   = clusterScreen(q.tc);
    const spd  = speedRef.current;
    const dur  = spd === 'fast' ? 1100 : spd === 'slow' ? 2800 : 1700;

    setQuestions(prev => prev.map((x, i) => i === 0 ? { ...x, dispatching:true } : x));

    setTimeout(() => {
      launch(from, to, {
        type: 'question',
        color: q.src === 'CSO-generated' ? 'black' : 'darkgray',
        label: q.text.slice(0, 22) + '…',
        duration: dur,
        onArrive: () => {
          pulse(q.tc);
          setQuestions(prev =>
            prev.filter(x => x.id !== q.id).map((x, i) => ({ ...x, rank: i + 1 }))
          );
        },
      });
    }, 250);
  }, [queueScreen, clusterScreen, launch, pulse]);

  const stepEmpRequest = useCallback(() => {
    const req = EMP_REQUESTS[Math.floor(Math.random() * EMP_REQUESTS.length)];
    const r   = { ...req, id: uid() };
    setLeftR(prev => [r, ...prev].slice(0, 4));

    const spd    = speedRef.current;
    const delay  = spd === 'fast' ? 500 : spd === 'slow' ? 2000 : 1000;

    // Show routing decision
    setTimeout(() => {
      setActiveRoute(req.route);

      // If routed to queue → add a new question
      if (req.route === 'queue') {
        setTimeout(() => {
          setQuestions(prev => {
            const nq = {
              id: uid(), text: req.text,
              src:'Employee-generated', tc:'apac-ops-fl', rank:99,
            };
            return [...prev, nq].slice(0, 7).map((x, i) => ({ ...x, rank: i + 1 }));
          });
        }, delay + 400);
      }

      // Fade request and clear route
      setTimeout(() => {
        setLeftR(prev => prev.map(x => x.id === r.id ? { ...x, fading:true } : x));
        setTimeout(() => {
          setActiveRoute(null);
          setLeftR(prev => prev.filter(x => x.id !== r.id));
        }, 700);
      }, delay + 600);
    }, 900);
  }, []);

  const stepEmitAnswer = useCallback(() => {
    const ti  = Math.floor(Math.random() * 4);
    const cid = CLUSTER_DEFS[Math.floor(Math.random() * CLUSTER_DEFS.length)].id;
    const from = clusterScreen(cid);
    const to   = tileScreen(ti);
    const spd  = speedRef.current;
    const dur  = spd === 'fast' ? 900 : spd === 'slow' ? 2200 : 1400;

    launch(from, to, {
      type:  'answer',
      color: 'white',
      duration: dur,
      onArrive: () => {
        setTiles(prev => prev.map((t, i) => {
          if (i !== ti) return t;
          const newConf = clamp(t.confidence + Math.round((Math.random() - 0.38) * 7), 20, 98);
          const newDot  = parseFloat((Math.random()).toFixed(2));
          const newDots = [...t.dots.slice(-7), newDot];
          const spread  = Math.max(...newDots) - Math.min(...newDots);
          // Contradiction flag logic: every ~4 cycles on global-tal tile
          const flagged = t.id === 'global-tal' &&
            cycleRef.current.count % 4 === 3 &&
            spread > 0.5;
          return {
            ...t,
            confidence: newConf,
            dots:       newDots,
            pulsing:    true,
            flagged,
            trend:   newConf > t.confidence ? 'up' : newConf < t.confidence ? 'down' : null,
            lastUpdate: 'just now',
          };
        }));
        setTimeout(() => {
          setTiles(prev => prev.map((t, i) => i === ti ? { ...t, pulsing:false } : t));
        }, 600);
      },
    });
  }, [clusterScreen, tileScreen, launch]);

  // ── Main rAF loop ─────────────────────────────────────────
  useEffect(() => {
    const SPRING = 0.055, DAMPING = 0.79;

    function frame(ts) {
      rafRef.current = requestAnimationFrame(frame);
      if (!lastTsRef.current) { lastTsRef.current = ts; return; }

      const dt = Math.min(ts - lastTsRef.current, 50);
      lastTsRef.current = ts;
      frameRef.current++;

      const cycleDur = SPEED_CFG[speedRef.current].cycle;
      cycleRef.current.elapsed += dt;
      if (cycleRef.current.elapsed >= cycleDur) {
        cycleRef.current.elapsed %= cycleDur;
        cycleRef.current.count++;
        stepsRef.current = {};
      }

      const t = cycleRef.current.elapsed / cycleDur;

      // Fire cycle steps (each fires once per cycle)
      const fire = (key, threshold, fn) => {
        if (!stepsRef.current[key] && t >= threshold) {
          stepsRef.current[key] = true;
          fn();
        }
      };
      fire('s1', 0.00, stepGenQuestion);
      fire('s2', 0.12, stepDispatch);
      fire('s3', 0.28, stepEmpRequest);
      fire('s4', 0.50, stepDispatch);
      fire('s5', 0.65, stepEmitAnswer);
      fire('s6', 0.78, stepEmitAnswer);
      fire('s7', 0.90, stepGenQuestion);

      // ── Spring simulation ──────────────────────────────────
      const filt = filtersRef.current;
      dotsRef.current = dotsRef.current.map(d => {
        const c = CLUSTER_DEFS.find(x => x.id === d.cid);
        if (!c) return d;
        const active = matchesFilter(d, filt);
        const scale  = active ? 1.0 : 0.35;
        const tx = c.cx + d.ox * scale;
        const ty = c.cy + d.oy * scale;
        const ax = (tx - d.x) * SPRING;
        const ay = (ty - d.y) * SPRING;
        const vx = (d.vx + ax) * DAMPING;
        const vy = (d.vy + ay) * DAMPING;
        return { ...d, x: d.x + vx, y: d.y + vy, vx, vy };
      });

      // ── Advance flying objects ─────────────────────────────
      const alive = [];
      for (const obj of flyingRef.current) {
        const np = Math.min(1, obj.progress + obj.spd * dt);
        const pt = cubicBezierPt(obj.from, obj.cp1, obj.cp2, obj.to, np);
        if (np >= 1) {
          if (obj.onArrive) obj.onArrive();
        } else {
          alive.push({ ...obj, progress: np, x: pt.x, y: pt.y });
        }
      }
      flyingRef.current = alive;

      // ── Advance pulse rings ────────────────────────────────
      pulsesRef.current = pulsesRef.current
        .map(p => ({ ...p, r: p.r + 0.5, alpha: p.alpha - 0.025 }))
        .filter(p => p.alpha > 0);

      // ── Sync to React at ~30 fps ───────────────────────────
      if (frameRef.current % 2 === 0) {
        setDots([...dotsRef.current]);
        setFlying([...flyingRef.current]);
        setPulses([...pulsesRef.current]);
      }
    }

    rafRef.current = requestAnimationFrame(frame);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [stepGenQuestion, stepDispatch, stepEmpRequest, stepEmitAnswer]); // stable refs

  // ── Filter handler ────────────────────────────────────────
  const handleFilter = useCallback((key, val) => {
    setFilters(prev => ({ ...prev, [key]: val }));
  }, []);

  // ─────────────────────────────────────────────────────────
  return (
    <>
      <InjectCSS />
      <div style={{
        display:'flex', flexDirection:'column',
        height:'100vh', width:'100vw',
        background:'#fff', overflow:'hidden',
        fontFamily:"-apple-system, BlinkMacSystemFont, 'Inter', sans-serif",
      }}>
        <TopBar speed={speed} onSpeed={setSpeed} />

        <div style={{
          flex:1, display:'flex', overflow:'hidden', position:'relative',
        }}>
          <LeftPanel requests={leftRequests} activeRoute={activeRoute} />

          <CenterPanel
            dots={dots}
            filters={filters}
            onFilterChange={handleFilter}
            svgRef={svgRef}
            pulses={pulses}
          />

          <RightPanel
            tiles={tiles}
            questions={questions}
            tileRefs={tileRefs}
            queueRef={queueRef}
          />
        </div>

        <SVGOverlay flyingObjects={flyingObjects} />
      </div>
    </>
  );
}
