import {createContext,useContext,useEffect,useState,type ReactNode} from "react";
import {WebsiteSessionSchema,type WebsiteSession} from "@leadboard/contracts";
const Context=createContext<{session:WebsiteSession;loading:boolean}>({session:{authenticated:false},loading:true});
export function WebsiteSessionProvider({children}:{children:ReactNode}){
  const [session,setSession]=useState<WebsiteSession>({authenticated:false});const [loading,setLoading]=useState(true);
  useEffect(()=>{let active=true;const refresh=()=>void fetch("/api/v1/auth/session",{cache:"no-store",credentials:"same-origin"})
    .then(async r=>{if(!r.ok)throw new Error();return WebsiteSessionSchema.parse(await r.json())})
    .then(s=>{if(active)setSession(s)}).catch(()=>{if(active)setSession({authenticated:false})})
    .finally(()=>{if(active)setLoading(false)});refresh();const timer=setInterval(refresh,60000);window.addEventListener('focus',refresh);return()=>{active=false;clearInterval(timer);window.removeEventListener('focus',refresh)};},[]);
  return <Context.Provider value={{session,loading}}>{children}</Context.Provider>;
}
export const useWebsiteSession=()=>useContext(Context);
