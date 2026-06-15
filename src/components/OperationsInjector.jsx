import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
// import { getFirestore, collection, getDocs, query, where } from 'firebase/firestore';

export default function OperationsInjector() {
  const { role, loading } = useAuth();
  const [operations, setOperations] = useState([]);
  const [selectedOp, setSelectedOp] = useState(null);
  const [formData, setFormData] = useState({});
  const [isExecuting, setIsExecuting] = useState(false);
  const [result, setResult] = useState(null);

  // Mocking the DB fetch based on the schema defined in Blocker #2.
  // In production, this would be: getDocs(query(collection(db, 'operations'), where('isActive', '==', true)))
  useEffect(() => {
    if (role === 'admin') {
      setOperations([
        {
          operationId: "op_001",
          name: "إضافة أداة استخراج جديدة", // Add New Extraction Tool
          description: "حقن نموذج جديد لاستخراج البيانات في النظام",
          accessLevel: "admin",
          schema: {
            type: "object",
            properties: {
              targetUrl: { type: "string", description: "رابط المصدر (URL)" },
              extractionDepth: { type: "number", description: "عمق الاستخراج (1-5)" }
            },
            required: ["targetUrl"]
          },
          executionEndpoint: "https://api.sahib-internal.com/v1/inject",
          isActive: true
        },
        {
          operationId: "op_002",
          name: "تحديث صلاحيات العمال", // Update Worker Permissions
          description: "تعديل صلاحيات الوصول لفرق العمل الميدانية",
          accessLevel: "admin",
          schema: {
            type: "object",
            properties: {
              workerId: { type: "string", description: "معرف العامل (Worker ID)" },
              newAccessLevel: { type: "string", description: "مستوى الوصول الجديد" }
            },
            required: ["workerId", "newAccessLevel"]
          },
          executionEndpoint: "https://api.sahib-internal.com/v1/permissions",
          isActive: true
        }
      ]);
    }
  }, [role]);

  if (loading) return <div className="text-zinc-500 text-center p-8" dir="rtl">جاري التحميل...</div>;
  
  // STRICT ROLE SEPARATION: Only admins can access the Injector.
  if (role !== 'admin') {
    return (
      <div dir="rtl" className="flex items-center justify-center min-h-[400px] bg-[#0a0a0a] text-zinc-400 font-arabic">
        <div className="border border-white/5 rounded-[14px] p-8 text-center bg-black/50 backdrop-blur-md">
          <p className="text-lg">صلاحيات غير كافية.</p>
          <p className="text-sm text-zinc-500 mt-2">هذه المساحة مخصصة للإدارة فقط.</p>
        </div>
      </div>
    );
  }

  const handleInputChange = (key, value) => {
    setFormData(prev => ({ ...prev, [key]: value }));
  };

  const handleExecute = async (e) => {
    e.preventDefault();
    setIsExecuting(true);
    setResult(null);

    try {
      // Simulate API call to the executionEndpoint
      console.log(`Executing ${selectedOp.executionEndpoint} with payload:`, formData);
      await new Promise(resolve => setTimeout(resolve, 1500));
      setResult({ success: true, message: "تم تنفيذ العملية بنجاح (Operation executed successfully)." });
    } catch (err) {
      setResult({ success: false, message: "حدث خطأ أثناء التنفيذ." });
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <div dir="rtl" className="min-h-screen bg-[#050505] text-zinc-200 font-arabic p-6">
      <div className="max-w-4xl mx-auto">
        <header className="mb-10 border-b border-white/10 pb-6">
          <h1 className="text-3xl font-bold tracking-tight text-white mb-2">حاقن العمليات (Operations Injector)</h1>
          <p className="text-zinc-500 text-sm">نظام إدارة الأدوات الديناميكية - مستوى الإدارة</p>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Sidebar: List of Operations */}
          <div className="md:col-span-1 space-y-4">
            <h2 className="text-sm font-semibold text-zinc-400 mb-4 px-2">العمليات المتاحة</h2>
            {operations.map(op => (
              <button
                key={op.operationId}
                onClick={() => {
                  setSelectedOp(op);
                  setFormData({});
                  setResult(null);
                }}
                className={`w-full text-right p-4 rounded-[14px] transition-all duration-300 border ${
                  selectedOp?.operationId === op.operationId
                    ? 'bg-zinc-900 border-white/20 shadow-lg'
                    : 'bg-[#0a0a0a] border-white/5 hover:border-white/10 hover:bg-zinc-900/50'
                }`}
              >
                <div className="text-md font-medium text-white">{op.name}</div>
                <div className="text-xs text-zinc-500 mt-2 truncate">{op.description}</div>
              </button>
            ))}
          </div>

          {/* Main Content: Dynamic Form Area */}
          <div className="md:col-span-2">
            {selectedOp ? (
              <div className="bg-[#0a0a0a] border border-white/10 rounded-[14px] p-8 shadow-2xl relative overflow-hidden">
                {/* Decorative Sahib subtle glow */}
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-zinc-700 to-transparent opacity-20"></div>

                <div className="mb-8">
                  <h2 className="text-xl font-bold text-white mb-2">{selectedOp.name}</h2>
                  <p className="text-sm text-zinc-400 leading-relaxed">{selectedOp.description}</p>
                </div>

                <form onSubmit={handleExecute} className="space-y-6">
                  {Object.entries(selectedOp.schema.properties).map(([key, propSchema]) => (
                    <div key={key} className="space-y-2">
                      <label className="block text-sm font-medium text-zinc-300">
                        {propSchema.description || key}
                        {selectedOp.schema.required?.includes(key) && <span className="text-red-500 mr-1">*</span>}
                      </label>
                      <input
                        type={propSchema.type === 'number' ? 'number' : 'text'}
                        required={selectedOp.schema.required?.includes(key)}
                        value={formData[key] || ''}
                        onChange={(e) => handleInputChange(key, e.target.value)}
                        dir={propSchema.type === 'number' ? 'ltr' : 'rtl'}
                        className="w-full bg-[#050505] border border-white/10 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-white/30 focus:ring-1 focus:ring-white/30 transition-colors"
                        placeholder="..."
                      />
                    </div>
                  ))}

                  <div className="pt-6 border-t border-white/5 flex items-center justify-between">
                    <button
                      type="submit"
                      disabled={isExecuting}
                      className="bg-white text-black font-semibold rounded-[10px] px-8 py-3 text-sm hover:bg-zinc-200 transition-colors disabled:opacity-50 flex items-center gap-2"
                    >
                      {isExecuting ? 'جاري التنفيذ...' : 'تنفيذ العملية'}
                    </button>

                    <div className="text-xs text-zinc-600 font-mono" dir="ltr">
                      POST {new URL(selectedOp.executionEndpoint).pathname}
                    </div>
                  </div>
                </form>

                {result && (
                  <div className={`mt-6 p-4 rounded-lg text-sm ${result.success ? 'bg-emerald-950/30 text-emerald-400 border border-emerald-900/50' : 'bg-red-950/30 text-red-400 border border-red-900/50'}`}>
                    {result.message}
                  </div>
                )}
              </div>
            ) : (
              <div className="h-full border border-dashed border-white/10 rounded-[14px] flex items-center justify-center text-zinc-600 bg-black/20">
                الرجاء تحديد عملية للبدء
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}