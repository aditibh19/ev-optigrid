import React from 'react';
export function EnergyChart({series,unit='kWh',labels=[],height=245}) {
  const width=760, xStart=55,xEnd=742, yStart=18,yEnd=height-31;
  const n=Math.max(1,...series.map(s=>s.values.length));
  const max=Math.max(1,...series.flatMap(s=>s.values.filter(Number.isFinite)));
  const scale=Math.ceil(max/4*100)/100*4;
  const x=i=>xStart+(xEnd-xStart)*i/Math.max(1,n-1);
  const y=v=>yEnd-(yEnd-yStart)*v/scale;
  return <>
    <svg className="chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={series.map(s=>s.label).join(' and ')+' in '+unit}>
      {[0,1,2,3,4].map(i=><g key={i}><line x1={xStart} x2={xEnd} y1={y(scale*i/4)} y2={y(scale*i/4)} stroke="#e3e9e4"/>
        <text x={xStart-9} y={y(scale*i/4)+4} textAnchor="end">{+(scale*i/4).toFixed(2)}</text></g>)}
      {series.map(({label,color,values})=><g key={label}>
        <path fill="none" stroke={color} strokeWidth="2.8" strokeLinejoin="round" strokeLinecap="round"
          d={values.map((v,i)=>Number.isFinite(v)?`${Number.isFinite(values[i-1])?'L':'M'}${x(i)},${y(v)}`:'').join(' ')}/>
        {values.map((v,i)=>Number.isFinite(v)&&<circle key={i} cx={x(i)} cy={y(v)} r="2.7" fill={color}>
          <title>{labels[i]||'Hour '+(i+1)} · {label} · {v.toFixed(2)} {unit}</title></circle>)}
      </g>)}
      {[...new Set([0,Math.floor((n-1)/4),Math.floor((n-1)/2),Math.floor((n-1)*3/4),n-1])].map(i=>
        <text key={i} x={x(i)} y={height-9} textAnchor={i===0?'start':i===n-1?'end':'middle'}>{labels[i]||'+'+(i+1)+'h'}</text>)}
    </svg>
    <div className="legend">{series.map(s=><span key={s.label}><i style={{background:s.color}}/>{s.label}</span>)}<span>{unit}</span></div>
  </>;
}
