import {createContext,useContext,useEffect,useState,type ReactNode} from "react";
import {WebsiteSessionSchema,type WebsiteSession} from "@leadboard/contracts";
const Context=createContext<{session:WebsiteSession;loading:boolean}>({session:{authenticated:false},loading:true});
export function WebsiteSessionProvider({children}:{children:ReactNode}){
  const [session,setSession]=useState<WebsiteSession>({authenticated:false});const [loading,setLoading]=useState(true);
  useEffect(()=>{let active=true;void fetch("/api/v1/auth/session",{cache:"no-store",credentials:"same-origin"})
    .then(async r=>{if(!r.ok)throw new Error();return WebsiteSessionSchema.parse(await r.json())})
    .then(s=>{if(active)setSession(s)}).catch(()=>{if(active)setSession({authenticated:false})})
    .finally(()=>{if(active)setLoading(false)});return()=>{active=false};},[]);
  return <Context.Provider value={{session,loading}}>{children}</Context.Provider>;
}
export const useWebsiteSession=()=>useContext(Context);
