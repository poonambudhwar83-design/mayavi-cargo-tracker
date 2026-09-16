import { NextResponse } from 'next/server';

const ORIGINAL_FLAG='__mayavi_original';

export function proxy(request){
  if(request.nextUrl.pathname!=='/api/track')return NextResponse.next();
  if(request.nextUrl.searchParams.get(ORIGINAL_FLAG)==='1')return NextResponse.next();
  const url=request.nextUrl.clone();
  url.pathname='/api/track-router';
  return NextResponse.rewrite(url);
}

export const config={matcher:'/api/track'};
