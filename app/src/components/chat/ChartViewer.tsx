import { 
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, 
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer 
} from 'recharts';

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d'];

export default function ChartViewer({ data, chartType = 'bar' }: { data: any[], chartType?: string }) {
  if (!data || data.length === 0) return <div className="p-4 text-gray-500">Không có dữ liệu</div>;

  // Tự động tìm cột nào là Chữ (Trục X) và cột nào là Số (Trục Y)
  const keys = Object.keys(data[0]);
  const xAxisKey = keys[0]; 
  let yAxisKey = keys[1] || keys[0]; 

  // Cố gắng tìm cột có chứa số liệu để làm Trục Y
  for (const key of keys) {
    if (typeof data[0][key] === 'number') {
      yAxisKey = key;
      break;
    }
  }

  // Render biểu đồ dựa theo chartType
  return (
    <div className="w-full h-[400px] mt-4 bg-white p-4 rounded-lg border">
      <ResponsiveContainer width="100%" height="100%">
        {chartType === 'pie' ? (
          <PieChart>
            <Tooltip />
            <Legend />
            <Pie data={data} dataKey={yAxisKey} nameKey={xAxisKey} cx="50%" cy="50%" outerRadius={120} label>
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
          </PieChart>
        ) : chartType === 'line' ? (
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey={xAxisKey} />
            <YAxis />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey={yAxisKey} stroke="#8884d8" activeDot={{ r: 8 }} />
          </LineChart>
        ) : (
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey={xAxisKey} />
            <YAxis />
            <Tooltip />
            <Legend />
            <Bar dataKey={yAxisKey} fill="#8884d8" />
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}