import { useState } from 'react';
import { ArrowUpRight, Download } from 'lucide-react';
import { Empty, Field, LineChart, SectionTitle } from './ui';
import { exportDiagnostics, summarize, type TestResult } from './domain';
import { download } from './storage';
import { ms, clock } from './format';
export function History({
  history,
  select,
  clear,
}: {
  history: TestResult[];
  select: (result: TestResult) => void;
  clear: () => void;
}) {
  const [filter, setFilter] = useState('all');
  const [selectedSeries,setSelectedSeries]=useState('');
  const rows = history.filter((item) => filter === 'all' || item.kind === filter);
  const series=[...new Map(rows.map(item=>[`${item.kind}:${item.host}`,{kind:item.kind,host:item.host}])).entries()];
  const active=series.find(([key])=>key===selectedSeries)??series[0];
  const chart=rows.filter(item=>`${item.kind}:${item.host}`===active?.[0]).slice(0,10).reverse();
  return (
    <section className="panel">
      <SectionTitle
        title="Your test notebook"
        detail="Only tests you chose to run. Stored on this device."
        action={
          <button
            className="button secondary"
            onClick={() => download('WaveScope-diagnostics.csv', exportDiagnostics(rows), 'text/csv')}
          >
            <Download size={15} />
            Export CSV
          </button>
        }
      />
      <div className="toolbar">
        <select aria-label="Filter history type" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">All test types</option>
          <option value="icmp">ICMP ping</option>
          <option value="dns">DNS lookup</option>
          <option value="http">HTTPS reachability</option>
        </select>
        <button className="button danger" onClick={clear}>
          Clear history
        </button>
      </div>
      {rows.length ? (
        <>
          <Field label="Compare measurement series"><select value={active?.[0]??''} onChange={event=>setSelectedSeries(event.target.value)}>
            {series.map(([key,value])=><option value={key} key={key}>{value.kind.toUpperCase()} · {value.host}</option>)}</select></Field>
          <p className="subtle">Each line compares the same test type and destination. DNS and HTTPS duration are not ICMP latency.</p>
          <LineChart
            values={chart.map(item=>summarize(item.samples).average)}
            labels={chart.map(item=>clock(item.started))}
            unit={`ms · ${active?.[1].kind.toUpperCase()} · ${active?.[1].host}`}
          />
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Destination</th>
                  <th>Type / time</th>
                  <th>Average</th>
                  <th>Failed</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((item) => {
                  const stats = summarize(item.samples);
                  return (
                    <tr key={item.id}>
                      <td>
                        <strong>{item.host}</strong>
                      </td>
                      <td>
                        {item.kind.toUpperCase()}
                        <small>{new Date(item.started).toLocaleString()}</small>
                      </td>
                      <td>{ms(stats.average)} ms</td>
                      <td>{stats.loss.toFixed(0)}%</td>
                      <td>
                        <button className="text-link plain-button" onClick={() => select(item)}>
                          View results
                          <ArrowUpRight size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <Empty
          title="A fresh notebook"
          text="Run your first diagnostic. Each result will be saved here for comparison."
        />
      )}
    </section>
  );
}
