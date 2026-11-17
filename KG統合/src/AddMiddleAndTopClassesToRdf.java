import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import org.apache.jena.graph.Node;
import org.apache.jena.graph.NodeFactory;
import org.apache.jena.riot.Lang;
import org.apache.jena.riot.RDFDataMgr;
import org.apache.jena.sparql.core.DatasetGraph;
import org.apache.jena.sparql.core.DatasetGraphFactory;
import org.apache.jena.sparql.core.Quad;

/** N-Quadsの主語・目的語に中間／上位クラスのrdf:typeだけを加えます。 */
public final class AddMiddleAndTopClassesToRdf {
    private static final Path DEFAULT_INPUT_RDF = Paths.get(
            "input/base-rdf/REV-KG-DEV_kg-data_2026-08-13_13-18-16.nq");
    private static final Path DEFAULT_INPUT_HIERARCHY = Paths.get(
            "input/target-classes/class-update-20261117-094934-210.json");
    private static final Path DEFAULT_OUTPUT_RDF = Paths.get(
            "output/classes/REV-KG-DEV_kg-data_2026-08-13_13-18-16_with-hierarchy.nq");

    private static final String NS = "https://kozaki-lab.jp/REFV-KG/class/";
    private static final String RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
    private static final String RDFS_SUBCLASS = "http://www.w3.org/2000/01/rdf-schema#subClassOf";
    private static final Node HIERARCHY_GRAPH = NodeFactory.createURI(
            "https://kozaki-lab.jp/REFV-KG/graph/definitions");
    private static final Node TYPE = NodeFactory.createURI(RDF_TYPE);
    private static final Node SUBCLASS = NodeFactory.createURI(RDFS_SUBCLASS);

    private AddMiddleAndTopClassesToRdf() {}

    public static void main(String[] args) throws IOException {
        if (args.length > 3) {
            throw new IllegalArgumentException(
                    "使い方: java AddMiddleAndTopClassesToRdf [入力N-Quads] [階層JSON] [出力N-Quads]");
        }
        Path inputRdf = args.length > 0 ? Paths.get(args[0]) : DEFAULT_INPUT_RDF;
        Path inputHierarchy = args.length > 1 ? Paths.get(args[1]) : DEFAULT_INPUT_HIERARCHY;
        Path outputRdf = args.length > 2 ? Paths.get(args[2]) : DEFAULT_OUTPUT_RDF;
        Path unmappedReport = outputRdf.toAbsolutePath().resolveSibling("unmapped-classes.txt");
        if (!Files.isRegularFile(inputRdf)) {
            throw new IOException("入力N-Quadsがありません: " + inputRdf.toAbsolutePath());
        }
        if (!Files.isRegularFile(inputHierarchy)) {
            throw new IOException("階層JSONがありません: " + inputHierarchy.toAbsolutePath());
        }

        Hierarchy hierarchy = readHierarchy(inputHierarchy);
        DatasetGraph source = DatasetGraphFactory.createTxnMem();
        DatasetGraph result = DatasetGraphFactory.createTxnMem();
        try {
            RDFDataMgr.read(source, inputRdf.toUri().toString(), Lang.NQUADS);
            Iterator<Quad> inputQuads = source.find();
            while (inputQuads.hasNext()) result.add(inputQuads.next());

            addHierarchyTriples(result, hierarchy);
            Set<String> unmapped = new java.util.TreeSet<>();
            long addedTypes = addAncestorTypes(source, result, hierarchy.parents, unmapped);
            writeAtomically(outputRdf, result);
            writeUnmappedReport(unmapped, unmappedReport);

            System.out.println("加工済みN-Quads: " + outputRdf.toAbsolutePath());
            System.out.println("階層JSONの親子関係数: " + hierarchy.parents.size());
            System.out.println("追加した中間・上位rdf:type数: " + addedTypes);
            System.out.println("親情報がないクラス数: " + unmapped.size());
            if (!unmapped.isEmpty()) System.out.println("未対応一覧: " + unmappedReport);
        } finally {
            result.close();
            source.close();
        }
    }

    private static Hierarchy readHierarchy(Path path) throws IOException {
        JsonObject root;
        try (var reader = Files.newBufferedReader(path, StandardCharsets.UTF_8)) {
            root = JsonParser.parseReader(reader).getAsJsonObject();
        }

        Map<String, String> parents = new HashMap<>();
        JsonArray relations = root.getAsJsonArray("relations");
        if (relations == null || relations.isEmpty()) {
            throw new IOException("階層JSONにrelationsがないか、空です: " + path);
        }
        for (JsonElement element : relations) {
            JsonObject relation = element.getAsJsonObject();
            String child = relation.get("child").getAsString();
            String parent = relation.get("parent").getAsString();
            String previous = parents.putIfAbsent(child, parent);
            if (previous != null && !previous.equals(parent)) {
                throw new IOException("複数の親が設定されています: " + child);
            }
        }
        validateAcyclic(parents);
        return new Hierarchy(parents);
    }

    static long applyToDataset(DatasetGraph dataset, Path hierarchyPath, Set<String> unmapped)
            throws IOException {
        Hierarchy hierarchy = readHierarchy(hierarchyPath);
        addHierarchyTriples(dataset, hierarchy);
        return addAncestorTypes(dataset, dataset, hierarchy.parents, unmapped);
    }

    private static void validateAcyclic(Map<String, String> parents) throws IOException {
        Set<String> complete = new HashSet<>();
        for (String start : parents.keySet()) {
            Set<String> path = new HashSet<>();
            String current = start;
            while (parents.containsKey(current) && !complete.contains(current)) {
                if (!path.add(current)) throw new IOException("クラス階層に循環があります: " + current);
                current = parents.get(current);
            }
            complete.addAll(path);
        }
    }

    private static void addHierarchyTriples(DatasetGraph output, Hierarchy hierarchy) {
        for (Map.Entry<String, String> entry : hierarchy.parents.entrySet()) {
            output.add(Quad.create(HIERARCHY_GRAPH, NodeFactory.createURI(entry.getKey()), SUBCLASS,
                    NodeFactory.createURI(entry.getValue())));
        }
    }

    private static long addAncestorTypes(DatasetGraph source, DatasetGraph output,
            Map<String, String> parents, Set<String> unmapped) {
        Set<Quad> additions = new LinkedHashSet<>();
        Iterator<Quad> quads = source.find(Node.ANY, Node.ANY,
                NodeFactory.createURI(RDF_TYPE), Node.ANY);
        while (quads.hasNext()) {
            Quad quad = quads.next();
            Node directClass = quad.getObject();
            if (!directClass.isURI() || !directClass.getURI().startsWith(NS + "c_")) continue;

            String current = directClass.getURI();
            if (!parents.containsKey(current)) {
                unmapped.add(current);
                continue;
            }
            Set<String> visited = new HashSet<>();
            while (parents.containsKey(current)) {
                current = parents.get(current);
                if (!visited.add(current)) throw new IllegalStateException("循環を検出しました: " + current);
                additions.add(Quad.create(quad.getGraph(), quad.getSubject(), TYPE,
                        NodeFactory.createURI(current)));
            }
        }
        long added = 0;
        for (Quad addition : additions) {
            if (!output.contains(addition.getGraph(), addition.getSubject(),
                    addition.getPredicate(), addition.getObject())) {
                output.add(addition);
                added++;
            }
        }
        return added;
    }

    private static void writeUnmappedReport(Set<String> unmapped, Path report) throws IOException {
        Files.createDirectories(report.toAbsolutePath().getParent());
        String contents = unmapped.isEmpty() ? "" : String.join(System.lineSeparator(), unmapped)
                + System.lineSeparator();
        Files.writeString(report, contents, StandardCharsets.UTF_8);
    }

    private static void writeAtomically(Path output, DatasetGraph dataset) throws IOException {
        Path absoluteOutput = output.toAbsolutePath();
        Files.createDirectories(absoluteOutput.getParent());
        Path temporary = absoluteOutput.resolveSibling(absoluteOutput.getFileName() + ".tmp");
        try {
            try (OutputStream stream = Files.newOutputStream(temporary)) {
                RDFDataMgr.write(stream, dataset, Lang.NQUADS);
            }
            try {
                Files.move(temporary, absoluteOutput, StandardCopyOption.ATOMIC_MOVE,
                        StandardCopyOption.REPLACE_EXISTING);
            } catch (java.nio.file.AtomicMoveNotSupportedException e) {
                Files.move(temporary, absoluteOutput, StandardCopyOption.REPLACE_EXISTING);
            }
        } finally {
            Files.deleteIfExists(temporary);
        }
    }

    private record Hierarchy(Map<String, String> parents) {}
}
