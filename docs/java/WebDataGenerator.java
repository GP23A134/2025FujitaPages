import java.io.IOException;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

/** 統合JSONを、Webページが読み込むapp.jsへ変換します。 */
public final class WebDataGenerator {
    private static final Path INPUT_DIRECTORY = Paths.get("data/integrated-data");
    private static final Path OUTPUT_FILE = Paths.get("app.js");
    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();

    private WebDataGenerator() {}

    public static void main(String[] args) throws IOException {
        JsonObject appData = new JsonObject();
        appData.add("classData", readJson("class-data.json"));
        appData.add("instanceClassData", readJson("instance-class-data.json"));
        appData.add("middleClassList", readJson("middle-class-list.json"));
        appData.add("topClassList", readJson("top-class-list.json"));

        try (Writer writer = Files.newBufferedWriter(OUTPUT_FILE, StandardCharsets.UTF_8)) {
            writer.write("window.appData = ");
            GSON.toJson(appData, writer);
            writer.write(";\n");
        }
        System.out.println("Web用app.jsを生成しました: " + OUTPUT_FILE);
    }

    private static JsonElement readJson(String fileName) throws IOException {
        Path input = INPUT_DIRECTORY.resolve(fileName);
        if (!Files.isRegularFile(input)) {
            throw new IOException("統合JSONが見つかりません: " + input);
        }
        try (var reader = Files.newBufferedReader(input, StandardCharsets.UTF_8)) {
            return JsonParser.parseReader(reader);
        }
    }
}
