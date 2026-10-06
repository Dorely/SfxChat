// SfxChat MIT. Uses unmodified BSD-licensed libogg/libvorbis and LGPL-2.1-licensed FluidSynth; see third-party notices.
#include <windows.h>
#include <wincrypt.h>
#include <aclapi.h>
#include <sddl.h>
#include <fcntl.h>
#include <io.h>
#include <cstdio>
#include <cstring>
#include <vector>
#include <string>
#include <algorithm>
#include <vorbis/vorbisenc.h>
#include <fluidsynth.h>

static int fail(const char* message) { fprintf(stderr, "%s\n", message); return 1; }
static bool page(ogg_page* p) {
    return fwrite(p->header, 1, p->header_len, stdout) == (size_t)p->header_len && fwrite(p->body, 1, p->body_len, stdout) == (size_t)p->body_len;
}
static int encode() {
    unsigned char h[44];
    if (fread(h, 1, 44, stdin) != 44 || memcmp(h,"RIFF",4) || memcmp(h+8,"WAVEfmt ",8) || memcmp(h+36,"data",4)) return fail("Expected canonical PCM WAV input.");
    auto u16 = [&](int p) { return unsigned(h[p]) | (unsigned(h[p+1]) << 8); };
    auto u32 = [&](int p) { return unsigned(h[p]) | (unsigned(h[p+1]) << 8) | (unsigned(h[p+2]) << 16) | (unsigned(h[p+3]) << 24); };
    unsigned channels = u16(22), rate = u32(24), remaining = u32(40);
    if (u16(20)!=1 || u16(34)!=16 || channels<1 || channels>2 || rate<8000 || rate>192000 || remaining>64*1024*1024 || remaining%(channels*2)) return fail("Vorbis export supports mono/stereo PCM, 8-192 kHz, up to 64 MiB. Use original or WAV for other channel counts.");
    vorbis_info info; vorbis_info_init(&info);
    if (vorbis_encode_init_vbr(&info,channels,rate,0.5f)) { vorbis_info_clear(&info); return fail("Vorbis initialization failed."); }
    vorbis_comment comment; vorbis_comment_init(&comment); vorbis_comment_add_tag(&comment,"ENCODER","SfxChat libvorbis 1.3.7 quality 5");
    vorbis_dsp_state dsp; vorbis_analysis_init(&dsp,&info);
    vorbis_block block; vorbis_block_init(&dsp,&block);
    ogg_stream_state stream; ogg_stream_init(&stream,1);
    ogg_packet a,b,c,packet; ogg_page output;
    vorbis_analysis_headerout(&dsp,&comment,&a,&b,&c);
    ogg_stream_packetin(&stream,&a); ogg_stream_packetin(&stream,&b); ogg_stream_packetin(&stream,&c);
    bool ok=true;
    while (ogg_stream_flush(&stream,&output)) ok = page(&output) && ok;
    std::vector<short> samples(1024*channels);
    bool ended=false;
    while (ok && !ended) {
        unsigned frames = remaining / (channels*2); if (frames>1024) frames=1024;
        if (frames) {
            if (fread(samples.data(),channels*2,frames,stdin)!=frames) { ok=false; break; }
            float** pcm=vorbis_analysis_buffer(&dsp,frames);
            for(unsigned f=0;f<frames;f++) for(unsigned ch=0;ch<channels;ch++) pcm[ch][f]=samples[f*channels+ch]/32768.f;
            remaining-=frames*channels*2;
        } else ended=true;
        vorbis_analysis_wrote(&dsp,frames);
        while(vorbis_analysis_blockout(&dsp,&block)==1) {
            vorbis_analysis(&block,nullptr); vorbis_bitrate_addblock(&block);
            while(vorbis_bitrate_flushpacket(&dsp,&packet)) {
                ogg_stream_packetin(&stream,&packet);
                while(ogg_stream_pageout(&stream,&output)) ok=page(&output)&&ok;
            }
        }
    }
    ogg_stream_clear(&stream); vorbis_block_clear(&block); vorbis_dsp_clear(&dsp); vorbis_comment_clear(&comment); vorbis_info_clear(&info);
    return ok && !fflush(stdout) ? 0 : fail("Truncated PCM or output write failed.");
}
static int protect(bool decrypt) {
    std::vector<unsigned char> bytes; unsigned char block[4096]; size_t n;
    while((n=fread(block,1,sizeof(block),stdin))) { bytes.insert(bytes.end(),block,block+n); if(bytes.size()>65536) return fail("Discovery data too large."); }
    DATA_BLOB in{(DWORD)bytes.size(),bytes.data()}, out{};
    BOOL ok=decrypt ? CryptUnprotectData(&in,nullptr,nullptr,nullptr,nullptr,CRYPTPROTECT_UI_FORBIDDEN,&out)
                    : CryptProtectData(&in,L"SfxChat local bridge",nullptr,nullptr,nullptr,CRYPTPROTECT_UI_FORBIDDEN,&out);
    if(!ok) return fail("Windows could not protect/unprotect bridge discovery.");
    bool written=fwrite(out.pbData,1,out.cbData,stdout)==out.cbData;
    SecureZeroMemory(out.pbData,out.cbData); LocalFree(out.pbData);
    return written ? 0 : fail("Discovery write failed.");
}
static int secureDirectory(wchar_t* path) {
    HANDLE token; if(!OpenProcessToken(GetCurrentProcess(),TOKEN_QUERY,&token)) return fail("Cannot resolve current Windows user.");
    DWORD size=0; GetTokenInformation(token,TokenUser,nullptr,0,&size); std::vector<unsigned char> data(size);
    if(!GetTokenInformation(token,TokenUser,data.data(),size,&size)) { CloseHandle(token); return fail("Cannot resolve user SID."); }
    CloseHandle(token); LPWSTR sid=nullptr;
    if(!ConvertSidToStringSidW(((TOKEN_USER*)data.data())->User.Sid,&sid)) return fail("Cannot format user SID.");
    std::wstring sddl=L"D:P(A;OICI;FA;;;SY)(A;OICI;FA;;;"; sddl+=sid; sddl+=L")"; LocalFree(sid);
    PSECURITY_DESCRIPTOR descriptor=nullptr;
    if(!ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl.c_str(),SDDL_REVISION_1,&descriptor,nullptr)) return fail("Cannot create private ACL.");
    BOOL present,defaulted; PACL acl; GetSecurityDescriptorDacl(descriptor,&present,&acl,&defaulted);
    DWORD error=SetNamedSecurityInfoW(path,SE_FILE_OBJECT,DACL_SECURITY_INFORMATION|PROTECTED_DACL_SECURITY_INFORMATION,nullptr,nullptr,acl,nullptr);
    LocalFree(descriptor); return error==ERROR_SUCCESS ? 0 : fail("Cannot restrict bridge discovery directory.");
}
// Keep the existing registry value type, entry spelling and empty PATH segments.
static int updatePath(const wchar_t* directory, bool remove) {
    HKEY environment, ownership;
    if (RegCreateKeyExW(HKEY_CURRENT_USER,L"Environment",0,nullptr,0,KEY_QUERY_VALUE|KEY_SET_VALUE,nullptr,&environment,nullptr)!=ERROR_SUCCESS) return fail("Cannot open user environment.");
    if (RegCreateKeyExW(HKEY_CURRENT_USER,L"Software\\SfxChat",0,nullptr,0,KEY_QUERY_VALUE|KEY_SET_VALUE,nullptr,&ownership,nullptr)!=ERROR_SUCCESS) { RegCloseKey(environment); return fail("Cannot open installation record."); }
    auto read = [](HKEY key,const wchar_t* name,std::wstring& value,DWORD& type) {
        DWORD bytes=0;
        LSTATUS error=RegGetValueW(key,nullptr,name,RRF_RT_REG_SZ|RRF_RT_REG_EXPAND_SZ|RRF_NOEXPAND,&type,nullptr,&bytes);
        if(error==ERROR_FILE_NOT_FOUND) { type=REG_EXPAND_SZ; return true; }
        if(error!=ERROR_SUCCESS) return false;
        std::vector<wchar_t> buffer(bytes/sizeof(wchar_t)+1,0);
        if(RegGetValueW(key,nullptr,name,RRF_RT_REG_SZ|RRF_RT_REG_EXPAND_SZ|RRF_NOEXPAND,&type,buffer.data(),&bytes)!=ERROR_SUCCESS) return false;
        value=buffer.data(); return true;
    };
    std::wstring path,owned,target=directory; DWORD pathType,ownedType;
    if(!read(environment,L"Path",path,pathType) || !read(ownership,L"AgentPath",owned,ownedType)) { RegCloseKey(ownership); RegCloseKey(environment); return fail("Cannot read user PATH safely."); }
    std::vector<std::wstring> parts; size_t offset=0;
    if(!path.empty()) do { size_t end=path.find(L';',offset); if(end==std::wstring::npos) end=path.size(); parts.push_back(path.substr(offset,end-offset)); offset=end+1; } while(offset<=path.size());
    auto same = [](const std::wstring& a,const std::wstring& b) { return !_wcsicmp(a.c_str(),b.c_str()); };
    bool present=std::any_of(parts.begin(),parts.end(),[&](const auto& p){return same(p,target);});
    bool changed=false;
    if(remove && same(owned,target)) {
        parts.erase(std::remove_if(parts.begin(),parts.end(),[&](const auto& p){return same(p,target);}),parts.end()); changed=true;
    } else if(!remove && !present) {
        if(!owned.empty()) parts.erase(std::remove_if(parts.begin(),parts.end(),[&](const auto& p){return same(p,owned);}),parts.end());
        parts.push_back(target); changed=true;
    }
    DWORD error=ERROR_SUCCESS;
    if(changed) {
        std::wstring next; for(size_t i=0;i<parts.size();i++) { if(i) next+=L';'; next+=parts[i]; }
        error=RegSetValueExW(environment,L"Path",0,pathType,(const BYTE*)next.c_str(),(DWORD)((next.size()+1)*sizeof(wchar_t)));
        if(error==ERROR_SUCCESS) {
            if(remove) RegDeleteValueW(ownership,L"AgentPath");
            else error=RegSetValueExW(ownership,L"AgentPath",0,REG_SZ,(const BYTE*)target.c_str(),(DWORD)((target.size()+1)*sizeof(wchar_t)));
            DWORD_PTR result; SendMessageTimeoutW(HWND_BROADCAST,WM_SETTINGCHANGE,0,(LPARAM)L"Environment",SMTO_ABORTIFHUNG,2000,&result);
        }
    }
    RegCloseKey(ownership); RegCloseKey(environment); return error==ERROR_SUCCESS ? 0 : fail("Cannot update user PATH or installation record.");
}
// Renders a Standard MIDI File through a SoundFont bank to a 16-bit stereo WAV, offline and faster than realtime.
static std::string utf8(const wchar_t* value) {
    int size=WideCharToMultiByte(CP_UTF8,0,value,-1,nullptr,0,nullptr,nullptr);
    std::string text(size>0?size_t(size-1):0,'\0');
    if(size>0) WideCharToMultiByte(CP_UTF8,0,value,-1,&text[0],size,nullptr,nullptr);
    return text;
}
static void put32(unsigned char* p,unsigned v){ p[0]=v&255; p[1]=(v>>8)&255; p[2]=(v>>16)&255; p[3]=(v>>24)&255; }
static void put16(unsigned char* p,unsigned v){ p[0]=v&255; p[1]=(v>>8)&255; }
static void quietLog(int,const char*,void*) {}
// FluidSynth's player reports success for a file it could not open, which would otherwise render silence.
static bool readableMidi(const wchar_t* path) {
    FILE* file=_wfopen(path,L"rb");
    if(!file) return false;
    unsigned char header[14];
    bool ok=fread(header,1,14,file)==14 && !memcmp(header,"MThd",4);
    fclose(file);
    return ok;
}
static void wavHeader(unsigned char* h,unsigned dataBytes) {
    memcpy(h,"RIFF",4); put32(h+4,36+dataBytes); memcpy(h+8,"WAVEfmt ",8); put32(h+16,16); put16(h+20,1); put16(h+22,2);
    put32(h+24,44100); put32(h+28,44100*4); put16(h+32,4); put16(h+34,16); memcpy(h+36,"data",4); put32(h+40,dataBytes);
}
static int renderMidi(const wchar_t* midi,const wchar_t* soundfont,const wchar_t* output,double gain) {
    fluid_settings_t* settings=new_fluid_settings();
    if(!settings) return fail("Could not create synthesizer settings.");
    fluid_set_log_function(FLUID_WARN,quietLog,nullptr);
    fluid_set_log_function(FLUID_INFO,quietLog,nullptr);
    fluid_set_log_function(FLUID_DBG,quietLog,nullptr);
    fluid_settings_setnum(settings,"synth.sample-rate",44100.0);
    fluid_settings_setnum(settings,"synth.gain",gain);
    fluid_settings_setint(settings,"synth.reverb.active",1);
    fluid_settings_setint(settings,"synth.chorus.active",1);
    fluid_settings_setstr(settings,"player.timing-source","sample");
    fluid_synth_t* synth=new_fluid_synth(settings);
    fluid_player_t* player=nullptr; FILE* file=nullptr; const char* failure=nullptr;
    if(!synth) failure="Could not create the synthesizer.";
    else {
        fluid_synth_add_sfloader(synth,new_fluid_defsfloader(settings));
        if(fluid_synth_sfload(synth,utf8(soundfont).c_str(),1)==FLUID_FAILED) failure="Could not load the soundfont bank.";
    }
    if(!failure) {
        player=new_fluid_player(synth);
        if(!readableMidi(midi)) failure="Could not read the MIDI file.";
        else if(!player || fluid_player_add(player,utf8(midi).c_str())==FLUID_FAILED) failure="Could not read the MIDI file.";
    }
    if(!failure) {
        file=_wfopen(output,L"wb");
        if(!file) failure="Could not create the WAV output.";
    }
    if(!failure) {
        unsigned char header[44]; memset(header,0,sizeof(header));
        if(fwrite(header,1,sizeof(header),file)!=sizeof(header)) failure="Could not write the WAV header.";
    }
    const unsigned frames=4096; std::vector<short> samples(frames*2); unsigned long long total=0, limit=44100ULL*60*12;
    if(!failure && fluid_player_play(player)==FLUID_FAILED) failure="Could not start MIDI playback.";
    while(!failure && fluid_player_get_status(player)==FLUID_PLAYER_PLAYING) {
        if(total>=limit) { failure="The MIDI clip exceeds the render limit."; break; }
        fluid_synth_write_s16(synth,frames,samples.data(),0,2,samples.data(),1,2);
        if(fwrite(samples.data(),sizeof(short),frames*2,file)!=frames*2) { failure="Could not write rendered audio."; break; }
        total+=frames;
    }
    for(unsigned i=0; !failure && i<44100*2/frames+1; i++) { // let reverb and chorus tails ring out
        fluid_synth_write_s16(synth,frames,samples.data(),0,2,samples.data(),1,2);
        if(fwrite(samples.data(),sizeof(short),frames*2,file)!=frames*2) failure="Could not write rendered audio.";
        total+=frames;
    }
    if(file) {
        if(!failure) {
            unsigned char header[44]; wavHeader(header,(unsigned)(total*4));
            if(_fseeki64(file,0,SEEK_SET) || fwrite(header,1,sizeof(header),file)!=sizeof(header)) failure="Could not finalize the WAV output.";
        }
        fclose(file);
    }
    if(player) delete_fluid_player(player);
    if(synth) delete_fluid_synth(synth);
    delete_fluid_settings(settings);
    if(failure) { _wremove(output); return fail(failure); }
    return 0;
}
int wmain(int argc,wchar_t** argv) {
    _setmode(_fileno(stdin),_O_BINARY); _setmode(_fileno(stdout),_O_BINARY);
    if(argc==2 && !wcscmp(argv[1],L"encode")) return encode();
    if(argc==5 && !wcscmp(argv[1],L"render-midi")) return renderMidi(argv[2],argv[3],argv[4],0.5);
    if(argc==6 && !wcscmp(argv[1],L"render-midi")) return renderMidi(argv[2],argv[3],argv[4],_wtof(argv[5]));
    if(argc==2 && !wcscmp(argv[1],L"protect")) return protect(false);
    if(argc==2 && !wcscmp(argv[1],L"unprotect")) return protect(true);
    if(argc==3 && !wcscmp(argv[1],L"secure-directory")) return secureDirectory(argv[2]);
    if(argc==3 && !wcscmp(argv[1],L"path-add")) return updatePath(argv[2],false);
    if(argc==3 && !wcscmp(argv[1],L"path-remove")) return updatePath(argv[2],true);
    return fail("Expected encode, render-midi, protect, unprotect, or secure-directory PATH.");
}
