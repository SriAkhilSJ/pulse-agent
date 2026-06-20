import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

class ErrorBoundary extends React.Component<React.PropsWithChildren,{hasError:boolean;error:string}> {
  constructor(props:React.PropsWithChildren){super(props);this.state={hasError:false,error:''}}
  static getDerivedStateFromError(error:Error){return{hasError:true,error:error.message+'\n\n'+(error.stack||'')}}
  render(){
    if(this.state.hasError) return <div style={{padding:20,color:'#f14c4c',fontFamily:'monospace',fontSize:13,whiteSpace:'pre-wrap'}}><div style={{fontSize:16,fontWeight:700,marginBottom:12}}>Webview Error</div>{this.state.error}</div>;
    return this.props.children;
  }
}

const container = document.getElementById('root');
if(container){
  const root = createRoot(container);
  root.render(<ErrorBoundary><App/></ErrorBoundary>);
} else {
  console.error('[Webview] #root not found');
}
