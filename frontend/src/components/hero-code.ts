// Original, illustrative snippets. Each lane repeats its full sequence so its loop has no seam.
export const codeLanes = [
  {
    id: "algorithms", duration: 75, phase: -19, opacity: .23,
    lines: [
      ["C++", "auto paths = dijkstra(graph, source);"],
      ["PY", "def bisect_left(xs, target): return next((i for i, x in enumerate(xs) if x >= target), len(xs))"],
      ["TS", "function topologicalSort(graph: Graph): Node[] { return visitInOrder(graph); }"],
      ["C", "for (size_t i = 0; i < count; ++i) running += values[i];"],
      ["PY", "frontier.extend(neighbor for neighbor in graph[node] if neighbor not in seen)"],
      ["C++", "std::ranges::sort(edges, {}, &Edge::weight);"],
      ["TS", "const components = findConnectedComponents(adjacencyList);"],
      ["PY", "while queue: node = queue.popleft(); distances[node] = depth[node]"],
    ],
  },
  {
    id: "math", duration: 94, phase: -31, opacity: .34,
    lines: [
      ["PY", "def ridge_solve(A, b, alpha): return np.linalg.solve(A.T @ A + alpha * np.eye(A.shape[1]), A.T @ b)"],
      ["JS", "const energy = samples.reduce((sum, x) => sum + x * x, 0);"],
      ["C++", "Matrix covariance = centered.transpose() * centered / (samples - 1);"],
      ["PY", "basis, singular_values, _ = np.linalg.svd(centered, full_matrices=False)"],
      ["TS", "const gram = multiply(transpose(features), features);"],
      ["PY", "weights = np.exp(logits - logits.max(axis=-1, keepdims=True))"],
      ["C", "for (int k = 0; k < cols; ++k) dot += lhs[row][k] * rhs[k][col];"],
    ],
  },
  {
    id: "react", duration: 82, phase: -9, opacity: .41,
    lines: [
      ["TSX", "const items = useMemo(() => rankContributors(activity), [activity]);"],
      ["TS", "type Contribution = Readonly<{ login: string; score: number }>;"],
      ["TSX", "function Score({ value }: { value: number }) { return <output>{value}</output>; }"],
      ["JS", "const indexed = new Map(commits.map(commit => [commit.sha, commit]));"],
      ["TSX", "const [query, setQuery] = useState('');"],
      ["TS", "const response = await fetch('/api/v1/contributors/leaderboard');"],
      ["JS", "const screenWidth = window.matchMedia('(min-width: 48rem)');"],
      ["TSX", "return contributors.map(person => <Profile key={person.login} {...person} />);"],
    ],
  },
  {
    id: "learning", duration: 106, phase: -56, opacity: .25,
    lines: [
      ["PY", "class ResidualBlock(nn.Module):"],
      ["PY", "def forward(self, x): return x + self.projection(self.norm(x))"],
      ["PY", "loss = F.cross_entropy(model(features), labels); loss.backward()"],
      ["PY", "optimizer.step(); optimizer.zero_grad(set_to_none=True)"],
      ["PY", "logits = (query @ key.transpose(-2, -1)) / math.sqrt(query.size(-1))"],
      ["PY", "attention = torch.softmax(logits, dim=-1) @ value"],
      ["PY", "centroids = torch.stack([vectors[assignments == i].mean(0) for i in range(k)])"],
      ["C++", "auto mean = std::accumulate(xs.begin(), xs.end(), 0.0) / xs.size();"],
    ],
  },
  {
    id: "systems", duration: 116, phase: -45, opacity: .16,
    lines: [
      ["C", "void enqueue(Queue *q, Node *node) { q->tail->next = node; q->tail = node; }"],
      ["C++", "std::vector<int> prefix(n + 1, 0);"],
      ["TS", "async function indexEvents(events: AsyncIterable<Activity>) { for await (const event of events) index.add(event); }"],
      ["PY", "with ThreadPoolExecutor(max_workers=4) as pool: results = list(pool.map(analyze, repositories))"],
      ["C++", "if (auto it = cache.find(key); it != cache.end()) return it->second;"],
      ["JS", "const grouped = Object.groupBy(repositories, repo => repo.language);"],
      ["PY", "heapq.heappush(frontier, (next_cost, neighbor))"],
      ["C", "size_t slot = (head + offset) % capacity;"],
    ],
  },
  {
    id: "signals", duration: 132, phase: -64, opacity: .11,
    lines: [
      ["PY", "window = np.hanning(frame.size); spectrum = np.fft.rfft(frame * window)"],
      ["JS", "const normalized = waveform.map(x => x / peakAmplitude);"],
      ["C++", "std::transform(signal.begin(), signal.end(), envelope.begin(), output.begin(), std::multiplies<>{});"],
      ["PY", "features = np.concatenate([spectrum.real, spectrum.imag], axis=-1)"],
      ["TS", "const smoothed = samples.map((x, i) => x * 0.7 + (samples[i - 1] ?? x) * 0.3);"],
      ["PY", "correlation = np.correlate(left_channel, right_channel, mode='full')"],
      ["C", "float phase = atan2f(imaginary, real);"],
    ],
  },
] as const;
