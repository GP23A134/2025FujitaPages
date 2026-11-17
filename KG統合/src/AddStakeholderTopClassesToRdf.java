import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.util.HashMap;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

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

/** Stakeholder JSONに基づき、st_クラスと個体にst_t_上位クラスを追加します。 */
public final class AddStakeholderTopClassesToRdf {
    private static final Path DEFAULT_INPUT_RDF = Paths.get(
            "input/base-rdf/REV-KG-DEV_kg-data_2026-08-13_13-18-16.nq");
    private static final Path DEFAULT_INPUT_JSON = Paths.get(
            "input/stakeholders/class-update-20261117-104033-219.json");
    private static final Path DEFAULT_OUTPUT_RDF = Paths.get(
            "input/integration/stakeholders-with-top.nq");

    private static final String CLASS_NS = "https://kozaki-lab.jp/REFV-KG/class/";
    private static final String RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
    private static final String RDFS_SUBCLASS = "http://www.w3.org/2000/01/rdf-schema#subClassOf";
    private static final Node TYPE = NodeFactory.createURI(RDF_TYPE);
    private static final Node SUBCLASS = NodeFactory.createURI(RDFS_SUBCLASS);
    private static final Node STAKEHOLDER_GRAPH = NodeFactory.createURI(
            "https://kozaki-lab.jp/REFV-KG/graph/stakeholder-hierarchy");

    private AddStakeholderTopClassesToRdf() {}

    public static void main(String[] args) throws IOException {
        if (args.length > 3) {
            throw new IllegalArgumentException("使い方: java AddStakeholderTopClassesToRdf "
                    + "[入力N-Quads] [ステークホルダーJSON] [出力N-Quads]");
        }
        Path inputRdf = args.length > 0 ? Paths.get(args[0]) : DEFAULT_INPUT_RDF;
        Path inputJson = args.length > 1 ? Paths.get(args[1]) : DEFAULT_INPUT_JSON;
        Path outputRdf = args.length > 2 ? Paths.get(args[2]) : DEFAULT_OUTPUT_RDF;
        Path report = outputRdf.toAbsolutePath().resolveSibling("unmapped-stakeholder-classes.txt");
        if (!Files.isRegularFile(inputRdf)) throw new IOException("入力N-Quadsがありません: " + inputRdf);
        if (!Files.isRegularFile(inputJson)) throw new IOException("ステークホルダーJSONがありません: " + inputJson);

        Map<String, String> parents = readParents(inputJson);
        DatasetGraph source = DatasetGraphFactory.createTxnMem();
        RDFDataMgr.read(source, inputRdf.toUri().toString(), Lang.NQUADS);
        DatasetGraph output = DatasetGraphFactory.createTxnMem();
        Iterator<Quad> sourceQuads = source.find();
        while (sourceQuads.hasNext()) output.add(sourceQuads.next());

        addSubclassRelations(output, parents);
        Set<String> unmapped = new TreeSet<>();
        long addedTypes = addTopTypes(source, output, parents, unmapped);
        writeAtomically(outputRdf, output);
        writeReport(report, unmapped);

        System.out.println("加工済みN-Quads: " + outputRdf.toAbsolutePath());
        System.out.println("ステークホルダー親子関係数: " + parents.size());
        System.out.println("追加したst_t_ rdf:type数: " + addedTypes);
        System.out.println("親情報がないst_クラス数: " + unmapped.size());
        if (!unmapped.isEmpty()) System.out.println("未対応一覧: " + report);
    }

    private static Map<String, String> readParents(Path jsonPath) throws IOException {
        JsonObject root;
        try (var reader = Files.newBufferedReader(jsonPath, StandardCharsets.UTF_8)) {
            root = JsonParser.parseReader(reader).getAsJsonObject();
        }
        Map<String, String> topIds = new HashMap<>();
        if (root.getAsJsonArray("classes") == null || root.getAsJsonArray("relations") == null) {
            throw new IOException("ステークホルダーJSONにclassesまたはrelationsがありません: " + jsonPath);
        }
        for (JsonElement element : root.getAsJsonArray("classes")) {
            JsonObject clazz = element.getAsJsonObject();
            if (!clazz.has("type") || clazz.get("type").isJsonNull()
                    || !"top".equals(clazz.get("type").getAsString())) continue;
            String id = clazz.get("id").getAsString();
            String canonicalId;
            if (id.equals("t_0")) {
                canonicalId = CLASS_NS + "st_t_0";
            } else if (id.matches("new-t_\\d+")) {
                canonicalId = CLASS_NS + "st_t_" + id.substring("new-t_".length());
            } else if (id.matches("t_\\d+")) {
                canonicalId = CLASS_NS + "st_t_" + id.substring(2);
            } else {
                throw new IOException("上位クラスIDの形式が不正です: " + id);
            }
            topIds.put(id, canonicalId);
        }

        Map<String, String> parents = new LinkedHashMap<>();
        for (JsonElement element : root.getAsJsonArray("relations")) {
            JsonObject relation = element.getAsJsonObject();
            String child = relation.get("child").getAsString();
            String rawParent = relation.get("parent").getAsString();
            if (!child.startsWith(CLASS_NS + "st_")) {
                throw new IOException("ステークホルダークラス(st_)ではありません: " + child);
            }
            String parent = topIds.get(rawParent);
            if (parent == null) throw new IOException("JSONに上位クラスがありません: " + rawParent);
            String previous = parents.putIfAbsent(child, parent);
            if (previous != null && !previous.equals(parent)) {
                throw new IOException("複数の上位クラスが設定されています: " + child);
            }
        }
        return parents;
    }

    private static void addSubclassRelations(DatasetGraph output, Map<String, String> parents) {
        for (Map.Entry<String, String> entry : parents.entrySet()) {
            output.add(Quad.create(STAKEHOLDER_GRAPH, NodeFactory.createURI(entry.getKey()), SUBCLASS,
                    NodeFactory.createURI(entry.getValue())));
        }
    }

    private static long addTopTypes(DatasetGraph source, DatasetGraph output,
            Map<String, String> parents, Set<String> unmapped) {
        Set<Quad> additions = new LinkedHashSet<>();
        Iterator<Quad> quads = source.find(Node.ANY, Node.ANY, TYPE, Node.ANY);
        while (quads.hasNext()) {
            Quad quad = quads.next();
            Node stakeholderClass = quad.getObject();
            if (!stakeholderClass.isURI() || !stakeholderClass.getURI().startsWith(CLASS_NS + "st_")) continue;
            String topClass = parents.get(stakeholderClass.getURI());
            if (topClass == null) {
                unmapped.add(stakeholderClass.getURI());
                continue;
            }
            additions.add(Quad.create(quad.getGraph(), quad.getSubject(), TYPE, NodeFactory.createURI(topClass)));
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

    private static void writeReport(Path path, Set<String> unmapped) throws IOException {
        Files.createDirectories(path.toAbsolutePath().getParent());
        String contents = unmapped.isEmpty() ? "" : String.join(System.lineSeparator(), unmapped)
                + System.lineSeparator();
        Files.writeString(path, contents, StandardCharsets.UTF_8);
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
}
