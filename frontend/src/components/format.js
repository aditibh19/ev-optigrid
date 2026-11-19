export const names={seasonal:'Seasonal naïve',lstm:'LSTM',hybrid:'CNN–BiLSTM–Attention'};
export const number=(value,digits=2)=>Number.isFinite(value)?value.toFixed(digits):'—';
export const dateLabel=value=>value?.replace('T',' ').slice(0,16)+' UTC';
export const money=value=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value);
