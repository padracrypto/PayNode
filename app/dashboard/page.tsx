'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { supabase } from '../../lib/supabase';

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState('PENDING');
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchProjects() {
      // این بار فقط گفتیم همه پروژه‌ها رو بیار و کاری به تاریخ نداشته باش
      const { data, error } = await supabase
        .from('projects')
        .select('*');
      
      // این دو خط رو اضافه کردم تا اگر باز هم مشکلی بود، بهمون دقیق بگه مشکل چیه
      console.log("Supabase Error:", error);
      console.log("Supabase Data:", data);
      
      if (!error && data) {
        setProjects(data);
      }
      setLoading(false);
    }
    
    fetchProjects();
  }, []);

  const filteredProjects = projects.filter(p => {
    const projectStatus = (p.status || 'PENDING').toUpperCase();
    return projectStatus === activeTab;
  });

  return (
    <div className="min-h-screen bg-slate-900 text-white p-6 md:p-10">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-3xl font-extrabold mb-8 tracking-tight">Dashboard</h1>
        
        <div className="flex border-b border-slate-700 mb-6 space-x-8">
          {['PENDING', 'ACTIVE', 'COMPLETED'].map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`pb-3 text-sm font-medium transition-all ${activeTab === tab ? 'border-b-2 border-green-400 text-green-400' : 'text-slate-400 hover:text-slate-300'}`}
            >
              {tab}
            </button>
          ))}
        </div>

        {loading ? (
          <p className="text-slate-400 animate-pulse">⏳ Loading your projects...</p>
        ) : filteredProjects.length === 0 ? (
          <p className="text-slate-500 italic">No projects found in this category.</p>
        ) : (
          <div className="space-y-4">
            {filteredProjects.map((project) => (
              <div key={project.id} className="bg-slate-800 p-5 rounded-xl border border-slate-700 flex justify-between items-center hover:border-slate-500 transition-all">
                <div>
                  <h3 className="text-lg font-bold text-white">{project.title}</h3>
                  <p className="text-sm text-slate-400 mt-1 line-clamp-1">{project.description}</p>
                </div>
                <div className="text-right">
                  <p className="font-bold text-green-400">{project.budget} USDC</p>
                  <Link href={`/project/${project.id}`}>
                    <button className="mt-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded-lg transition-all">
                      View Details ➡️
                    </button>
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}