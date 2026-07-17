'use client';

import { useState } from 'react';
import { supabase } from '../../../lib/supabase';

export default function StartProject() {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState(''); // ✨ این خط برای توضیحات اضافه شد
  const [budget, setBudget] = useState('');
  const [statusMsg, setStatusMsg] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatusMsg('⏳ Saving to database...');

    // ✨ حالا توضیحات رو هم همراه با بقیه اطلاعات می‌فرستیم به دیتابیس
    const { error } = await supabase
      .from('projects')
      .insert([
        { 
          title: title, 
          description: description, 
          budget: parseFloat(budget) 
        }
      ]);

    if (error) {
      setStatusMsg('❌ Error: ' + error.message);
    } else {
      setStatusMsg('✅ Project successfully created!');
      setTitle(''); 
      setDescription(''); // خالی کردن توضیحات بعد از موفقیت
      setBudget('');
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 text-white p-6 flex flex-col items-center py-12">
      <div className="max-w-xl w-full bg-slate-800 rounded-2xl p-8 shadow-2xl border border-slate-700">
        <h2 className="text-3xl font-bold mb-2">Start a New Project</h2>
        <p className="text-slate-400 mb-8 text-sm">Fill out the details below.</p>
        
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-sm text-slate-300 mb-1">Project Title</label>
            <input 
              type="text" 
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-slate-900 border border-slate-600 rounded-lg p-3 text-white" 
            />
          </div>

          {/* ✨ این بخش برای باکس توضیحات به فرم اضافه شد */}
          <div>
            <label className="block text-sm text-slate-300 mb-1">Project Description</label>
            <textarea 
              required
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-slate-900 border border-slate-600 rounded-lg p-3 text-white" 
            />
          </div>

          <div>
            <label className="block text-sm text-slate-300 mb-1">Budget (USDC)</label>
            <input 
              type="number" 
              required
              min="0" 
              step="any"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              className="w-full bg-slate-900 border border-slate-600 rounded-lg p-3 text-white" 
            />
          </div>
          
          <button type="submit" className="w-full mt-4 py-4 rounded-xl bg-green-500 text-slate-900 font-bold text-lg hover:bg-green-400 transition-all">
            Create Project
          </button>

          {statusMsg && (
            <p className="text-center mt-4 text-sm font-medium text-slate-300">
              {statusMsg}
            </p>
          )}
        </form>
      </div>
    </div>
  );
}