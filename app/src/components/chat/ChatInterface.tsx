import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/use-toast";
import { useDatabase } from "@/contexts/DatabaseContext";
import { useAuth } from "@/contexts/AuthContext";
import { useSettings } from "@/contexts/SettingsContext";
import { useChat } from "@/contexts/ChatContext";
import LoadingSpinner from "@/components/ui/loading-spinner";
import { Skeleton } from "@/components/ui/skeleton";
import ChatMessage from "./ChatMessage";
import QueryInput from "./QueryInput";
import SuggestionCards from "../SuggestionCards";
import { ChatService } from "@/services/chat";
import type { ConfirmRequest } from "@/types/api";
import { getVendorPrefix } from "@/utils/vendorConfig";
import { Shield, ChevronDown, ChevronUp } from "lucide-react"; // 👈 ĐÃ THÊM ICON MỚI VÀO ĐÂY

interface ChatMessageData {
  id: string;
  type: 'user' | 'ai' | 'ai-steps' | 'sql-query' | 'query-result' | 'confirmation';
  content: string;
  steps?: Array<{
    icon: 'search' | 'database' | 'code' | 'message';
    text: string;
  }>;
  queryData?: any[]; // For table data
  analysisInfo?: {
    confidence?: number;
    missing?: string;
    ambiguities?: string;
    explanation?: string;
    isValid?: boolean;
  };
  confirmationData?: {
    sqlQuery: string;
    operationType: string;
    message: string;
    chatHistory: string[];
  };
  timestamp: Date;
}

export interface ChatInterfaceProps {
  className?: string;
  disabled?: boolean; // when true, block interactions
  onProcessingChange?: (isProcessing: boolean) => void; // callback to notify parent of processing state
  useMemory?: boolean; // Whether to use memory context
  useRulesFromDatabase?: boolean; // Whether to use rules from database (backend fetches them)
}

const ChatInterface = ({ 
  className, 
  disabled = false, 
  onProcessingChange, 
  useMemory = true,
  useRulesFromDatabase = true
}: ChatInterfaceProps) => {
  const { toast } = useToast();
  
  // ================= BẢO MẬT ĐA TẦNG =================
  const [sensitiveCols, setSensitiveCols] = useState(""); 
  const [rowFilter, setRowFilter] = useState("");         
  const [showSecurity, setShowSecurity] = useState(false); // 👈 THÊM STATE ĐỂ LƯU TRẠNG THÁI ẨN/HIỆN
  // ====================================================

  const { selectedGraph } = useDatabase();
  const { vendor, apiKey, modelName, isApiKeyValid } = useSettings();
  const { messages, setMessages, conversationHistory, isProcessing, setIsProcessing } = useChat();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom function
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // Loading message component using skeleton
  const LoadingMessage = () => (
    <div className="loading-message-container px-6">
      <div className="flex gap-3 mb-6 items-start">
        <div className="w-8 h-8 bg-purple-600 rounded-full flex items-center justify-center flex-shrink-0">
          <span className="text-white text-xs font-bold">QW</span>
        </div>
        <div className="flex-1 min-w-0 space-y-2">
          <Skeleton className="h-4 w-3/4 bg-muted" />
          <Skeleton className="h-4 w-1/2 bg-muted" />
          <Skeleton className="h-4 w-2/3 bg-muted" />
        </div>
      </div>
    </div>
  );

  const { user } = useAuth();

  const suggestions = [
    "Show me five customers",
    "Show me the top customers by revenue", 
    "What are the pending orders?"
  ];

  // Scroll to bottom whenever messages change
  useEffect(() => {
    scrollToBottom();
  }, [messages, isProcessing]);

  // Notify parent component of processing state changes
  useEffect(() => {
    onProcessingChange?.(isProcessing);
  }, [isProcessing, onProcessingChange]);

  const handleSendMessage = async (query: string) => {
  if (isProcessing || disabled) return; // Prevent multiple submissions or when disabled by parent

    if (!selectedGraph) {
      toast({
        title: "No Database Available",
        description: "Please upload a database schema first, or start the QueryWeaver backend to use real databases.",
        variant: "destructive",
      });
      return;
    }

    // Snapshot history before adding the current user message so the backend
    // sees only prior turns in `history` and the current query in `query`.
    const historySnapshot = [...conversationHistory.current];

    setIsProcessing(true);

    // Add user message
    const userMessage: ChatMessageData = {
      id: Date.now().toString(),
      type: "user",
      content: query,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    conversationHistory.current.push({ role: 'user', content: query });
    
    // Scroll to bottom immediately after adding user message
    setTimeout(() => scrollToBottom(), 100);
    
    // Show processing toast
    toast({
      title: "Processing Query",
      description: "Analyzing your question and generating response...",
    });
    
    try {
      let finalContent = "";
      let sqlQuery = "";
      let queryResults: any[] | null = null;
      let analysisInfo: {
        confidence?: number;
        missing?: string;
        ambiguities?: string;
        explanation?: string;
        isValid?: boolean;
      } = {};

      // ================= CHUẨN BỊ LỜI ĐE DỌA AI =================
      let aiPrompt = query;
      
      // Lớp 1: Cấm cột
      if (sensitiveCols.trim() !== "") {
        aiPrompt += `\n\n⚠️ [CRITICAL SECURITY WARNING]: YOU MUST COMPLETELY IGNORE AND NEVER USE THE FOLLOWING COLUMNS IN YOUR SQL: ${sensitiveCols.trim()}.`;
      }

      // Lớp 2: Ép điều kiện hàng
      if (rowFilter.trim() !== "") {
        aiPrompt += `\n\n⚠️ [ROW-LEVEL SECURITY]: YOU MUST ALWAYS INCLUDE THIS CONDITION IN THE 'WHERE' CLAUSE OF YOUR SQL STATEMENT: ${rowFilter.trim()}.`;
      }
      // ============================================================

      // Stream the query
      for await (const message of ChatService.streamQuery({
        query: aiPrompt,
        database: selectedGraph.id,
        history: historySnapshot,
        customApiKey: isApiKeyValid ? apiKey : undefined,
        customModel: isApiKeyValid ? modelName : undefined,
        customVendor: isApiKeyValid ? vendor : undefined,
        use_user_rules: useRulesFromDatabase,
        use_memory: useMemory,
      })) {
        
        if (message.type === 'status' || message.type === 'reasoning' || message.type === 'reasoning_step') {
          const stepText = message.content || message.message || '';
          
          const stepMessage: ChatMessageData = {
            id: `step-${Date.now()}-${Math.random()}`,
            type: "ai",
            content: stepText,
            timestamp: new Date(),
          };
          
          setMessages(prev => {
            const newMessages = [...prev, stepMessage];
            return newMessages;
          });
        } else if (message.type === 'sql_query') {
          sqlQuery = message.data || message.content || message.message || '';
          analysisInfo = {
            confidence: message.conf,
            missing: message.miss,
            ambiguities: message.amb,
            explanation: message.exp,
            isValid: message.is_valid
          };
        } else if (message.type === 'query_result') {
          queryResults = message.data || [];
        } else if (message.type === 'ai_response') {
          const responseContent = (message.message || message.content || '').trim();
          finalContent = responseContent;
        } else if (message.type === 'followup_questions') {
          const followupContent = (message.message || message.content || '').trim();
          finalContent = followupContent;
        } else if (message.type === 'error') {
          toast({
            title: "Query Failed",
            description: message.content,
            variant: "destructive",
          });
          finalContent = `Error: ${message.content}`;
        } else if (message.type === 'confirmation' || message.type === 'destructive_confirmation') {
          const confirmationMessage: ChatMessageData = {
            id: `confirm-${Date.now()}`,
            type: 'confirmation',
            content: message.message || message.content || '',
            confirmationData: {
              sqlQuery: message.sql_query || '',
              operationType: message.operation_type || 'UNKNOWN',
              message: message.message || message.content || '',
              chatHistory: conversationHistory.current.map(m => m.content),
            },
            timestamp: new Date(),
          };

          setMessages(prev => [...prev, confirmationMessage]);
          finalContent = "";
        }
        
        setTimeout(() => scrollToBottom(), 50);
      }

      if (sqlQuery !== undefined || Object.keys(analysisInfo).length > 0) {
        const sqlMessage: ChatMessageData = {
          id: (Date.now() + 2).toString(),
          type: "sql-query",
          content: sqlQuery,
          analysisInfo: analysisInfo,
          timestamp: new Date(),
        };
        setMessages(prev => [...prev, sqlMessage]);
      }
      
      if (queryResults && queryResults.length > 0) {
        const resultsMessage: ChatMessageData = {
          id: (Date.now() + 3).toString(),
          type: "query-result",
          content: "Query Results",
          queryData: queryResults,
          timestamp: new Date(),
        };
        setMessages(prev => [...prev, resultsMessage]);
      }
      
      if (finalContent) {
        const finalResponse: ChatMessageData = {
          id: (Date.now() + 4).toString(),
          type: "ai",
          content: finalContent,
          timestamp: new Date(),
        };
        
        setMessages(prev => [...prev, finalResponse]);
        conversationHistory.current.push({ role: 'assistant', content: finalContent });
      }
      
      toast({
        title: "Query Complete",
        description: "Successfully processed your database query!",
      });
    } catch (error) {
      console.error('Query failed:', error);
      
      const errorMessage: ChatMessageData = {
        id: (Date.now() + 2).toString(),
        type: "ai",
        content: `Failed to process query: ${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp: new Date(),
      };
      
      setMessages(prev => [...prev, errorMessage]);
      
      toast({
        title: "Query Failed",
        description: error instanceof Error ? error.message : "Failed to process query",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
      setTimeout(() => scrollToBottom(), 100);
    }
  };

  const handleConfirmDestructive = async (messageId: string) => {
    if (!selectedGraph) return;

    const confirmMessage = messages.find(m => m.id === messageId && m.type === 'confirmation');
    if (!confirmMessage?.confirmationData) return;

    setIsProcessing(true);

    setMessages(prev => prev.filter(m => m.id !== messageId));

    const executingMessage: ChatMessageData = {
      id: `executing-${Date.now()}`,
      type: 'ai',
      content: 'Executing confirmed operation...',
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, executingMessage]);

    toast({
      title: "Executing Operation",
      description: "Processing your confirmed operation...",
    });

    try {
      let finalContent = "";
      let queryResults: any[] | null = null;

      const confirmRequest: ConfirmRequest = {
        sql_query: confirmMessage.confirmationData.sqlQuery,
        confirmation: 'CONFIRM',
        chat: confirmMessage.confirmationData.chatHistory,
        use_user_rules: useRulesFromDatabase,
      };
      if (isApiKeyValid && apiKey) {
        confirmRequest.custom_api_key = apiKey;
        if (modelName && vendor) {
          const vendorPrefix = getVendorPrefix(vendor);
          confirmRequest.custom_model = modelName.startsWith(`${vendorPrefix}/`)
            ? modelName
            : `${vendorPrefix}/${modelName}`;
        }
      }

      for await (const message of ChatService.streamConfirmOperation(
        selectedGraph.id,
        confirmRequest
      )) {
        if (message.type === 'status' || message.type === 'reasoning' || message.type === 'reasoning_step') {
          const stepText = message.content || message.message || '';
          const stepMessage: ChatMessageData = {
            id: `step-${Date.now()}-${Math.random()}`,
            type: "ai",
            content: stepText,
            timestamp: new Date(),
          };
          setMessages(prev => [...prev, stepMessage]);
        } else if (message.type === 'query_result') {
          queryResults = message.data || [];
        } else if (message.type === 'ai_response') {
          const responseContent = (message.message || message.content || '').trim();
          finalContent = responseContent;
        } else if (message.type === 'error') {
          let errorMsg = message.message || message.content || 'Unknown error occurred';

          if (errorMsg.includes('duplicate key value violates unique constraint')) {
            const match = errorMsg.match(/Key \((\w+)\)=\(([^)]+)\)/);
            if (match) {
              const [, field, value] = match;
              errorMsg = `A record with ${field} "${value}" already exists.`;
            } else {
              errorMsg = 'This record already exists in the database.';
            }
          } else if (errorMsg.includes('violates foreign key constraint')) {
            errorMsg = 'Cannot perform this operation due to related records in other tables.';
          } else if (errorMsg.includes('violates not-null constraint')) {
            const match = errorMsg.match(/column "(\w+)"/);
            if (match) {
              errorMsg = `The field "${match[1]}" cannot be empty.`;
            } else {
              errorMsg = 'Required field cannot be empty.';
            }
          } else if (errorMsg.includes('PostgreSQL query execution error:') || errorMsg.includes('MySQL query execution error:')) {
            errorMsg = errorMsg.replace(/^(PostgreSQL|MySQL) query execution error:\s*/i, '');
            errorMsg = errorMsg.split('\n')[0];
          }

          toast({
            title: "Operation Failed",
            description: errorMsg,
            variant: "destructive",
          });
          finalContent = `${errorMsg}`;
        } else if (message.type === 'schema_refresh') {
          const refreshContent = message.message || message.content || '';
          const refreshMessage: ChatMessageData = {
            id: `refresh-${Date.now()}`,
            type: "ai",
            content: refreshContent,
            timestamp: new Date(),
          };
          setMessages(prev => [...prev, refreshMessage]);
        }

        setTimeout(() => scrollToBottom(), 50);
      }

      if (queryResults && queryResults.length > 0) {
        const resultsMessage: ChatMessageData = {
          id: (Date.now() + 3).toString(),
          type: "query-result",
          content: "Query Results",
          queryData: queryResults,
          timestamp: new Date(),
        };
        setMessages(prev => [...prev, resultsMessage]);
      }

      if (finalContent) {
        const finalResponse: ChatMessageData = {
          id: (Date.now() + 4).toString(),
          type: "ai",
          content: finalContent,
          timestamp: new Date(),
        };
        setMessages(prev => [...prev, finalResponse]);
        conversationHistory.current.push({ role: 'assistant', content: finalContent });
      }

      toast({
        title: "Operation Complete",
        description: "Successfully executed the operation!",
      });
    } catch (error) {
      console.error('Confirmation error:', error);

      const errorMessage: ChatMessageData = {
        id: (Date.now() + 2).toString(),
        type: "ai",
        content: `Failed to execute operation: ${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp: new Date(),
      };

      setMessages(prev => [...prev, errorMessage]);

      toast({
        title: "Operation Failed",
        description: error instanceof Error ? error.message : "Failed to execute operation",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
      setTimeout(() => scrollToBottom(), 100);
    }
  };

  const handleCancelDestructive = (messageId: string) => {
    setMessages(prev => prev.filter(m => m.id !== messageId));

    setMessages(prev => [
      ...prev,
      {
        id: `cancel-${Date.now()}`,
        type: 'ai',
        content: 'Operation cancelled. The destructive SQL query was not executed.',
        timestamp: new Date(),
      }
    ]);

    toast({
      title: "Operation Cancelled",
      description: "The destructive operation was not executed.",
    });
  };

  const handleSuggestionSelect = (suggestion: string) => {
    handleSendMessage(suggestion);
  };

  return (
    <div className={cn("flex flex-col h-full bg-background", className)} data-testid="chat-interface">
      {/* Messages Area */}
      <div ref={chatContainerRef} className="flex-1 overflow-y-auto scrollbar-hide overflow-x-hidden" data-testid="chat-messages-container">
        <div className="space-y-6 py-6 max-w-full">
          {messages.map((msg) => (
            <ChatMessage
              key={msg.id}
              type={msg.type}
              content={msg.content}
              steps={msg.steps}
              queryData={msg.queryData}
              analysisInfo={msg.analysisInfo}
              confirmationData={msg.confirmationData}
              user={user}
              onConfirm={msg.type === 'confirmation' ? () => handleConfirmDestructive(msg.id) : undefined}
              onCancel={msg.type === 'confirmation' ? () => handleCancelDestructive(msg.id) : undefined}
            />
          ))}
          {isProcessing && <LoadingMessage />}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Bottom Section with Suggestions and Input */}
      <div className="border-t border-border bg-background">
        <div className="p-6">

          {/* ================= GIAO DIỆN BẢO MẬT ĐA TẦNG (CÓ THU GỌN) ================= */}
          <div className="mb-4">
            {/* Nút Toggle */}
            <button
              onClick={() => setShowSecurity(!showSecurity)}
              className="flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors mb-2"
            >
              <Shield className="w-4 h-4 text-purple-500" />
              {showSecurity ? "Ẩn tùy chọn bảo mật" : "Thiết lập bảo mật nâng cao"}
              {showSecurity ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>

            {/* Nội dung được ẩn/hiện */}
            {showSecurity && (
              <div className="space-y-2 animate-in slide-in-from-top-2 fade-in-20 duration-200">
                {/* LỚP 1: Ô NHẬP CỘT CẤM */}
                <div className="flex items-center gap-3 p-3 bg-red-950/20 border border-red-900/50 rounded-lg">
                  <label className="text-red-400 text-sm font-semibold whitespace-nowrap min-w-[150px]">
                    🔒 Cấm cột (Column):
                  </label>
                  <input
                    type="text"
                    placeholder="VD: users.password, artists.Name"
                    value={sensitiveCols}
                    onChange={(e) => setSensitiveCols(e.target.value)}
                    className="flex-1 bg-background border border-border rounded px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-red-500 placeholder:text-muted-foreground"
                  />
                </div>

                {/* LỚP 2: Ô NHẬP ĐIỀU KIỆN HÀNG */}
                <div className="flex items-center gap-3 p-3 bg-blue-950/20 border border-blue-900/50 rounded-lg">
                  <label className="text-blue-400 text-sm font-semibold whitespace-nowrap min-w-[150px]">
                    🛡️ Ép điều kiện (Row):
                  </label>
                  <input
                    type="text"
                    placeholder="VD: role != 'admin' hoặc country = 'VN'"
                    value={rowFilter}
                    onChange={(e) => setRowFilter(e.target.value)}
                    className="flex-1 bg-background border border-border rounded px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-blue-500 placeholder:text-muted-foreground"
                  />
                </div>
              </div>
            )}
          </div>
          {/* ======================================================================= */}

          {/* Suggestion Cards - Only show for DEMO_CRM database */}
          {(selectedGraph?.id === 'DEMO_CRM' || selectedGraph?.name === 'DEMO_CRM') && (
            <SuggestionCards
              suggestions={suggestions}
              onSelect={handleSuggestionSelect}
              disabled={isProcessing || disabled}
            />
          )}
          
          {/* Query Input */}
          <QueryInput 
            onSubmit={handleSendMessage}
            placeholder="Ask me anything about your database..."
            disabled={isProcessing || disabled}
          />
          
          {/* Show loading indicator when processing */}
          {isProcessing && (
            <div className="flex items-center justify-center gap-2 mt-2" data-testid="processing-query-indicator">
              <LoadingSpinner size="sm" />
              <span className="text-muted-foreground text-sm">Processing your query...</span>
            </div>
          )}
          
          {/* Footer */}
          <div className="text-center mt-4">
            <p className="text-muted-foreground text-sm">
              Powered by <a href="https://falkordb.com" target="_blank">FalkorDB</a>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChatInterface;