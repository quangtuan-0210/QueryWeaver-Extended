import React, { useState, useEffect } from 'react';
import { Database, Search, Code, MessageSquare, AlertTriangle, Copy, Check, Table, BarChart2, PieChart, LineChart, ShieldCheck, Maximize2, X } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import Tree from 'react-d3-tree'; // BẮT BUỘC IMPORT THƯ VIỆN CÂY
import type { User as UserType } from '@/types/api';

import ChartViewer from './ChartViewer';

interface Step {
  icon: 'search' | 'database' | 'code' | 'message';
  text: string;
}

interface ChatMessageProps {
  type: 'user' | 'ai' | 'ai-steps' | 'sql-query' | 'query-result' | 'confirmation';
  content: string;
  steps?: Step[];
  queryData?: any[]; 
  analysisInfo?: {
    confidence?: number;
    missing?: string;
    ambiguities?: string;
    explanation?: string;
    isValid?: boolean;
    visualization?: {
      type: 'bar' | 'line' | 'pie' | null;
      default_view: 'chart' | 'table';
      label_column: string;
      value_column: string;
    };
  };
  confirmationData?: {
    sqlQuery: string;
    operationType: string;
    message: string;
  };
  progress?: number; 
  user?: UserType | null; 
  onConfirm?: () => void;
  onCancel?: () => void;
}

const ChatMessage = ({ type, content, steps, queryData, analysisInfo, confirmationData, progress, user, onConfirm, onCancel }: ChatMessageProps) => {
  const [copied, setCopied] = useState(false);
  const [viewMode, setViewMode] = useState<'table' | 'chart'>('table');
  const [chartType, setChartType] = useState<'bar' | 'line' | 'pie'>('bar');
  
  // --- STATE QUẢN LÝ SQL VÀ CÂY AST ---
  const [currentSql, setCurrentSql] = useState(content);
  const [isValidating, setIsValidating] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false); // STATE QUẢN LÝ NÚT PHÓNG TO
  
  // NÂNG CẤP: Chỉ lưu dữ liệu thô, không lưu giao diện HTML vào state nữa để tránh lỗi nút bấm
  const [validationResult, setValidationResult] = useState<{
    status: 'success' | 'failed' | 'fixed';
    logs?: string[];
    ast_tree?: any;
  } | null>(null);

  useEffect(() => {
    if (type === 'sql-query') {
      setCurrentSql(content);
      setValidationResult(null);
    }
  }, [content, type]);

  useEffect(() => {
    const hasVisualSignal = analysisInfo?.visualization?.default_view === 'chart';
    const hasChartHeaders = queryData && queryData.length > 0 && 
                             'label_column' in queryData[0] && 
                             'value_column' in queryData[0];

    if (hasVisualSignal || hasChartHeaders) {
      setViewMode('chart');
      if (analysisInfo?.visualization?.type) {
        setChartType(analysisInfo.visualization.type);
      } else {
        setChartType('bar'); 
      }
    }
  }, [analysisInfo, queryData]);

  const handleCopyQuery = async () => {
    try {
      await navigator.clipboard.writeText(type === 'sql-query' ? currentSql : content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy text:', err);
    }
  };

  // --- HÀM GỌI API VALIDATE VỀ BACKEND ---
  const handleValidateAST = async () => {
    setIsValidating(true);
    setValidationResult(null);
    try {
      const getCookie = (name: string) => {
        const value = `; ${document.cookie}`;
        const parts = value.split(`; ${name}=`);
        if (parts.length === 2) return parts.pop()?.split(';').shift();
        return '';
      };
      
      const csrfToken = getCookie('csrf_token') || getCookie('csrftoken') || getCookie('fastapi-csrf-token') || '';

      const response = await fetch('/api/validate', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
          'X-CSRFToken': csrfToken
        },
        credentials: 'same-origin',
        body: JSON.stringify({
          sql: currentSql,
          schema_text: '', 
          dialect: 'mysql'
        })
      });
      
      const data = await response.json();
      const isSuccess = data.is_valid || data.status === 'success' || data.status === 'fixed';
      
      if (isSuccess) {
        if (data.final_ast) setCurrentSql(data.final_ast);
        setValidationResult({ status: 'success', ast_tree: data.ast_tree });
      } else {
        const rawError = data.logs || data.errors || data.detail || JSON.stringify(data);
        const errorList = Array.isArray(rawError) ? rawError : [rawError];
        setValidationResult({ status: 'failed', logs: errorList, ast_tree: data.ast_tree });
      }
    } catch (e) {
      setValidationResult({ status: 'failed', logs: ['⚠️ Lỗi kết nối Backend (Fetch failed)'] });
    } finally { setIsValidating(false); }
  };
  
  // ==========================================
  // RENDER: BONG BÓNG CHAT CỦA USER (ĐÃ KHÔI PHỤC)
  // ==========================================
  if (type === 'user') {
    return (
      <div className="px-6" data-testid="user-message">
        <div className="flex justify-end gap-3 mb-6">
          <div className="flex-1 max-w-xl text-right">
            <Card className="bg-muted border-border inline-block">
              <CardContent className="p-3 text-left">
                <p className="text-foreground text-base leading-relaxed">{content}</p>
              </CardContent>
            </Card>
          </div>
          <Avatar className="h-10 w-10 border-2 border-primary flex-shrink-0">
            <AvatarImage src={user?.picture} />
            <AvatarFallback className="bg-primary text-primary-foreground font-medium">
              {(user?.name || user?.email || 'U').charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
        </div>
      </div>
    );
  }

  if (type === 'confirmation') {
    const operationType = (confirmationData?.operationType ?? 'UNKNOWN').toUpperCase();
    const isHighRisk = ['DELETE', 'DROP', 'TRUNCATE'].includes(operationType);
    return (
      <div className="px-6">
        <div className="flex gap-3 mb-6 items-start">
          <Avatar className="w-8 h-8 flex-shrink-0"><AvatarFallback className="bg-primary text-xs font-bold text-white">QW</AvatarFallback></Avatar>
          <div className="flex-1 min-w-0">
            <Card className={`${isHighRisk ? 'border-destructive/50 bg-destructive/5' : 'border-warning/50 bg-warning/5'}`}>
              <CardContent className="p-4 space-y-4">
                <div className="flex items-center gap-2">
                  <AlertTriangle className={`w-5 h-5 ${isHighRisk ? 'text-destructive' : 'text-warning'}`} />
                  <span className={`font-bold ${isHighRisk ? 'text-destructive' : 'text-warning'}`}>Destructive Operation Detected</span>
                </div>
                <div className="bg-background p-3 rounded border font-mono text-sm">{confirmationData?.sqlQuery}</div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={onCancel} className="flex-1">Cancel</Button>
                  <Button variant="destructive" onClick={onConfirm} className="flex-1">Confirm {operationType}</Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  // ==========================================
  // RENDER: KHUNG SQL VÀ KIỂM TRA AST
  // ==========================================
  if (type === 'sql-query') {
    
    // Xử lý dữ liệu cây JSON an toàn
    let treeData = null;
    let isJsonFormat = false;
    if (validationResult?.ast_tree) {
      if (typeof validationResult.ast_tree === 'object') {
        treeData = validationResult.ast_tree;
        isJsonFormat = true;
      } else if (typeof validationResult.ast_tree === 'string') {
        try {
          treeData = JSON.parse(validationResult.ast_tree);
          isJsonFormat = true;
        } catch(e) {}
      }
    }

    return (
      <div className="px-6">
        <div className="flex gap-3 mb-6 items-start">
          <Avatar className="w-8 h-8 flex-shrink-0"><AvatarFallback className="bg-primary text-xs font-bold text-white">QW</AvatarFallback></Avatar>
          <div className="flex-1 min-w-0">
            <Card className="bg-card border-primary/30 overflow-hidden">
              <CardContent className="p-4">
                <div className="flex justify-between items-center mb-4">
                  <div className="flex items-center gap-2">
                    <Code className="w-4 h-4 text-primary" />
                    <span className="font-semibold text-primary">Generated SQL</span>
                  </div>
                  <div className="flex gap-2">
                    <Button 
                      size="sm" 
                      onClick={handleValidateAST} 
                      disabled={isValidating}
                      className="bg-blue-600 hover:bg-blue-700 text-white h-8 text-xs font-bold px-3 transition-all"
                    >
                      {isValidating ? '⏳ Đang quét...' : <><ShieldCheck className="w-3 h-3 mr-1" /> Validate AST</>}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={handleCopyQuery} className="h-8 w-8 p-0">
                      {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                    </Button>
                  </div>
                </div>

                <div className="bg-black/50 p-4 rounded-md border border-white/10">
                  <pre className="text-sm font-mono text-blue-300 whitespace-pre-wrap break-all leading-relaxed">
                    <code>{currentSql}</code>
                  </pre>
                </div>

                {/* --- KHU VỰC HIỂN THỊ KẾT QUẢ AST --- */}
                {validationResult && (
                  <div className={`mt-3 p-3 rounded-md border text-sm animate-in fade-in slide-in-from-top-1 ${validationResult.status === 'failed' ? 'bg-red-950/40 border-red-500/50' : 'bg-green-950/40 border-green-500/50'}`}>
                    
                    {/* Báo lỗi hoặc thành công */}
                    {validationResult.status === 'success' ? (
                      <span className="text-green-400 font-bold block mb-1">✅ SQL An Toàn (AST Checked)</span>
                    ) : (
                      <div className="mb-2">
                        <span className="text-red-400 font-bold block mb-1">❌ Phát hiện vi phạm Rule:</span>
                        <ul className="list-disc pl-5 text-red-300 text-xs space-y-1">
                          {validationResult.logs?.map((err, i) => <li key={i}>{err}</li>)}
                        </ul>
                      </div>
                    )}

                    {/* Khung vẽ cây AST */}
                    {validationResult.ast_tree && (
                      <details className="mt-3 pt-2 border-t border-white/20 text-xs cursor-pointer">
                        <summary className="text-gray-400 hover:text-white mb-3 outline-none font-bold">🌳 Bấm để xem sơ đồ cây AST (X-Quang SQL)</summary>
                        
                        {!isJsonFormat ? (
                          <div>
                            <div className="bg-red-900/30 border border-red-500/50 p-3 rounded mb-2 text-red-400 font-bold">⚠️ Cảnh báo: Backend đang trả về Text, không phải JSON!</div>
                            <pre className="text-purple-300 bg-black/60 p-2 rounded overflow-x-auto whitespace-pre-wrap font-mono">{String(validationResult.ast_tree)}</pre>
                          </div>
                        ) : (
                          <div className="relative">
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              className="absolute top-2 right-2 z-10 bg-black/40 hover:bg-black/60 text-cyan-400 border border-cyan-500/30 h-8 w-8 p-0"
                              onClick={(e) => {
                                e.preventDefault();
                                setIsFullScreen(true); // BẬT TOÀN MÀN HÌNH CHUẨN XÁC
                              }}
                            >
                              <Maximize2 className="w-4 h-4" />
                            </Button>

                            <div style={{ width: '100%', height: '500px' }} className="bg-black/60 rounded border border-white/10 overflow-hidden relative">
                              <style>{`.rd3t-link { stroke: #00d8ff !important; stroke-width: 2px !important; }`}</style>
                              <Tree 
                                data={treeData} 
                                orientation="vertical" 
                                pathFunc="diagonal" 
                                translate={{ x: 350, y: 50 }} 
                                nodeSize={{ x: 150, y: 100 }} 
                                renderCustomNodeElement={({ nodeDatum, toggleNode }) => (
                                  <g>
                                    <circle r={15} fill="#0ea5e9" stroke="#00d8ff" strokeWidth={2} onClick={toggleNode} cursor="pointer" />
                                    <text fill="white" stroke="none" x={0} y={30} textAnchor="middle" fontSize="12px" fontFamily="mono">
                                      {nodeDatum.name}
                                      {nodeDatum.attributes && nodeDatum.attributes.label && ` (${nodeDatum.attributes.label})`}
                                    </text>
                                  </g>
                                )}
                              />
                            </div>
                          </div>
                        )}
                      </details>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        {/* ==========================================
            GIAO DIỆN TOÀN MÀN HÌNH (OVERLAY MODAL)
            Nằm ngoài các Card để không bị giới hạn khung
        ========================================== */}
        {isFullScreen && isJsonFormat && treeData && (
          <div className="fixed inset-0 z-[99999] bg-black/95 flex flex-col p-4 animate-in fade-in zoom-in duration-200">
            <div className="flex justify-between items-center mb-4 border-b border-white/10 pb-4">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-cyan-500 shadow-[0_0_10px_#00d8ff]"></div>
                <span className="text-cyan-400 font-bold text-lg uppercase tracking-widest">AST Fullscreen Mode</span>
              </div>
              <Button 
                variant="destructive" 
                size="sm" 
                onClick={() => setIsFullScreen(false)}
                className="bg-red-500/20 hover:bg-red-500 text-red-500 hover:text-white border border-red-500/50"
              >
                <X className="w-5 h-5 mr-1" /> Thoát (ESC)
              </Button>
            </div>
            
            <div className="flex-1 rounded-lg border border-cyan-500/20 bg-black/40 overflow-hidden cursor-move">
              <style>{`.rd3t-link { stroke: #00d8ff !important; stroke-width: 2px !important; }`}</style>
              <Tree 
                data={treeData} 
                orientation="vertical" 
                pathFunc="diagonal" 
                translate={{ x: window.innerWidth / 2, y: 100 }} 
                nodeSize={{ x: 200, y: 120 }} 
                renderCustomNodeElement={({ nodeDatum, toggleNode }) => (
                  <g>
                    <circle r={20} fill="#0ea5e9" stroke="#00d8ff" strokeWidth={3} onClick={toggleNode} cursor="pointer" />
                    <text fill="white" x={0} y={40} textAnchor="middle" fontSize="14px" fontWeight="bold" fontFamily="mono">
                      {nodeDatum.name}
                      {nodeDatum.attributes && nodeDatum.attributes.label && ` (${nodeDatum.attributes.label})`}
                    </text>
                  </g>
                )}
              />
            </div>
            <p className="text-center text-gray-500 text-xs mt-4">Tip: Sử dụng chuột để kéo và lăn chuột để Phóng to/Thu nhỏ cây</p>
          </div>
        )}
      </div>
    );
  }

  // RENDER: QUERY RESULT
  if (type === 'query-result') {
    return (
      <div className="px-6">
        <div className="flex gap-3 mb-6 items-start">
          <Avatar className="w-8 h-8 flex-shrink-0"><AvatarFallback className="bg-primary text-xs font-bold text-white">QW</AvatarFallback></Avatar>
          <div className="flex-1 min-w-0 max-w-full overflow-hidden">
            <Card className="bg-card border-green-500/30">
              <CardContent className="p-4">
                <div className="flex justify-between items-center mb-4">
                  <div className="flex items-center gap-2 text-green-500 font-bold">
                     <Database className="w-4 h-4" /> <span>Query Results</span>
                     <Badge variant="secondary">{queryData?.length || 0} rows</Badge>
                  </div>
                  
                  <div className="flex items-center gap-3">
                    {viewMode === 'chart' && (
                      <div className="flex items-center gap-1 border-r border-border pr-3">
                        <Button variant={chartType === 'bar' ? 'secondary' : 'ghost'} size="sm" className="h-8 px-2" onClick={() => setChartType('bar')} title="Biểu đồ Cột">
                          <BarChart2 className="w-4 h-4"/>
                        </Button>
                        <Button variant={chartType === 'line' ? 'secondary' : 'ghost'} size="sm" className="h-8 px-2" onClick={() => setChartType('line')} title="Biểu đồ Đường">
                          <LineChart className="w-4 h-4"/>
                        </Button>
                        <Button variant={chartType === 'pie' ? 'secondary' : 'ghost'} size="sm" className="h-8 px-2" onClick={() => setChartType('pie')} title="Biểu đồ Tròn">
                          <PieChart className="w-4 h-4"/>
                        </Button>
                      </div>
                    )}
                    <div className="flex gap-1 bg-muted p-1 rounded-md">
                      <Button variant={viewMode === 'table' ? 'default' : 'ghost'} size="sm" className="h-7 text-xs" onClick={() => setViewMode('table')}><Table className="w-3 h-3 mr-1"/> Bảng</Button>
                      <Button variant={viewMode === 'chart' ? 'default' : 'ghost'} size="sm" className="h-7 text-xs" onClick={() => setViewMode('chart')}><BarChart2 className="w-3 h-3 mr-1"/> Biểu đồ</Button>
                    </div>
                  </div>

                </div>
                <div className="overflow-x-auto border rounded border-border">
                  {viewMode === 'table' && queryData && queryData.length > 0 ? (
                    <table className="w-full text-sm text-left">
                       <thead className="bg-muted"><tr>{Object.keys(queryData[0]).map(k => <th key={k} className="p-2">{k}</th>)}</tr></thead>
                       <tbody>{queryData.map((r, i) => <tr key={i} className="border-t border-border">{Object.values(r).map((v:any, ci) => <td key={ci} className="p-2">{String(v)}</td>)}</tr>)}</tbody>
                    </table>
                  ) : <ChartViewer data={queryData || []} chartType={chartType} />}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  // RENDER: AI TEXT MESSAGE
  if (type === 'ai') {
    return (
      <div className="px-6">
        <div className="flex gap-3 mb-6 items-start">
          <Avatar className="w-8 h-8 flex-shrink-0"><AvatarFallback className="bg-primary text-xs font-bold text-white">QW</AvatarFallback></Avatar>
          <div className="flex-1 text-foreground text-base leading-relaxed whitespace-pre-line">{content}</div>
        </div>
      </div>
    );
  }

  // RENDER: AI STEPS / PROGRESS
  if (type === 'ai-steps') {
    return (
      <div className="px-6">
        <div className="flex gap-3 mb-6 items-start">
          <Avatar className="w-8 h-8 flex-shrink-0"><AvatarFallback className="bg-primary text-xs font-bold text-white">QW</AvatarFallback></Avatar>
          <div className="flex-1 max-w-md">
            <Card className="bg-card border-primary/30 p-4 space-y-3">
              {steps?.map((s, i) => (
                <div key={i} className="flex items-center gap-3 text-sm">
                  <div className="p-1 border border-primary rounded-md">
                    {s.icon === 'search' && <Search className="w-3 h-3 text-primary" />}
                    {s.icon === 'database' && <Database className="w-3 h-3 text-primary" />}
                    {s.icon === 'code' && <Code className="w-3 h-3 text-primary" />}
                    {s.icon === 'message' && <MessageSquare className="w-3 h-3 text-primary" />}
                  </div>
                  <span>{s.text}</span>
                </div>
              ))}
              {progress !== undefined && <Progress value={progress} className="h-2 mt-2" />}
            </Card>
          </div>
        </div>
      </div>
    );
  }

  return null;
};

export default ChatMessage;