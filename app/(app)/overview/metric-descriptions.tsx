import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

// The "man pages" tab of the Streamlit overview: sar's description per metric.
export function MetricDescriptions({
  metrics,
  descriptions,
}: {
  metrics: string[];
  descriptions: Record<string, string>;
}) {
  return (
    <div className="max-h-[380px] overflow-auto" data-testid="metric-descriptions">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-32">Metric</TableHead>
            <TableHead>Description (sar man page)</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {metrics.map((metric) => (
            <TableRow key={metric}>
              <TableCell className="align-top font-mono text-xs">{metric}</TableCell>
              <TableCell className="whitespace-normal text-sm">
                {descriptions[metric] || <span className="text-muted-foreground">No description</span>}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
