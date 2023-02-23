import fetch from "node-fetch";
import axios from 'axios';
import formidable from "formidable";
import fs from 'fs'
import { fileURLToPath } from 'url';
import path from 'path';
import pool from "../database.js"

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

var WebServiceUrl = "https://strusite.com/webservice/rest/server.php";

export const newRecord = async (req, res, next) => {
    var formData = new formidable.IncomingForm();
	formData.parse(req, async (error, fields, files) => {
        var extension = files.file.originalFilename.substr(files.file.originalFilename.lastIndexOf("."));
        var newPath = path.resolve(__dirname, '../uploads/TestFile'+ extension);
        fs.rename(files.file.filepath, newPath, function (errorRename) {
			console.log("File saved = " + newPath);
		});
        var selectCountries = { 
            "1": "Argentina", 
            "2": "Belice", 
            "3": "Bolivia", 
            "4": "Brasil", 
            "5": "Chile",
            "6": "Colombia",
            "7": "Costa Rica",
            "8": "Cuba",
            "9": "Ecuador",
            "10": "El Salvador",
            "11": "España",
            "12": "Guatemala",
            "13": "Haití",
            "14": "Honduras",
            "15": "Jamaica",
            "16": "México",
            "17": "Nicaragua",
            "18": "Panamá",
            "19": "Paraguay",
            "20": "Perú",
            "21": "República dominicana",
            "22": "Uruguay",
            "23": "Otro"
         };
        var selectCourses = { 
            "1": "Fundamentos Tekla Structures Acero", 
            "2": "Fundamentos Tekla Structures Hormigón", 
            "3": "Teoría y cálculo de uniones metálicas con IDEA STATICA", 
            "4": "Teoría y cálculo de elementos HA con IDEA STATICA", 
            "5": "Análisis y diseño de edificaciones con Tekla Structures Designer",
            "6": "Common Data Environment con Trimble Connect",
            "7": "Optimización de flujos BIM con Trimble Connect"
         };
        const {firstname, lastname, institution, countryid, courseid, email, phone} = fields;
        const username = firstname.substring(0,2)+lastname.substring(0,2);
        const country = selectCountries[parseInt(countryid)];
        const course = selectCourses[parseInt(courseid)];
        const newUser = { username, firstname, lastname, institution, country, course, email, phone};
        
        var user = await pool.query('SELECT * from users WHERE email = ?', newUser.email);
        console.log(user);

        if(user!=[])
        {
            await pool.query('INSERT INTO users set ?', [newUser])
            console.log("Nuevo registro exitoso" + newUser.email)
        }else{
            console.log("usuario ya registrado")
        }
        /*
        var qUser = await queryMoodleUser(newUser.email);
        var data = qUser.data.split("<hr>");
        let response = JSON.parse(data[2]);
        console.log(response);
        if(response[0].user){
            res("Usuario ya existe");
        }
        else
        {
            await pool.query('INSERT INTO users set ?', [newUser])
        }
        */
    });
}

export const queryUserdb = async (req, res, next) => {
    var users = await pool.query('SELECT * from users WHERE username = "judi"');
    console.log(users);
}

export const moodle = async () => {
    let fecha_now = new Date(); //Fecha Actual
    var mlSeconds = 24*60*60000;
    var newDateObj = new Date(fecha_now - mlSeconds);
    var userjd = await pool.query(`SELECT * FROM users WHERE submitted_at BETWEEN "2023-01-01 00:00:00" AND "${newDateObj.toISOString()}" AND campus_id = "0"`);
    if(userjd.length!=0){
        for(let i = 0; i <= userjd.length; i++){
            var mUser = { username: userjd[i].username, firstname: userjd[i].firstname, lastname: userjd[i].lastname, institution: userjd[i].institution, country: userjd[i].country, course: userjd[i].course, email: userjd[i].email, phone: userjd[i].phone};
            var qUser = await queryMoodleUser(userjd[i].email);
            var data = qUser.data.split("<hr>");
            let response = JSON.parse(data[2]);
            if(!response.users){
                    console.log("Usuario ya existe");
                    return "Usuario ya existe";
            }else{
                var newUser = await createMoodleUser(mUser);
                var newUserData = newUser.data.split("<hr>");
                let newUserRes = JSON.parse(newUserData[2]);
                console.log(newUserRes); // Todavía hay un problema con la ñ en algnos paises
                
                var enrollment = await enrollMoodleuser(newUserRes[0].id, 2);
                var addToGroup = await addUserToMoodleGroup(newUserRes[0].id, 1);

                await pool.query(`UPDATE users SET campus_id = ${newUserRes[0].id} WHERE email="${userjd[i].email}"`,  (err,res)=>{
                    console.log(err,res);
                    var response =  {Created: "ok", userId : newUserRes[0].id, enrollment: enrollment, group: addToGroup};
                    console.log(response);
                    return response;
                });
                //res.status(201).json({Created: "ok", userId : newUserRes[0].id, enrollment: enrollment, group: addToGroup});
                //console.log("Aqui se crea el usuario " + userjd[i].email + " y se enrola");
            }
        }
    }else{
        return "No hay usuarios nuevos";
    }
}

async function queryMoodleUser(email){
    const params = new URLSearchParams();
    params.append('moodlewsrestformat', 'json');
    params.append('wsfunction', 'core_user_get_users');
    params.append('wstoken', process.env.MDL_TOKEN);
    params.append('criteria[0][key]', 'email');
    params.append('criteria[0][value]', email);
    var config = {
        method: 'get',
        url: WebServiceUrl,
        headers: {},
        params :  params
      };

    let res = await axios(config)
    return res;
}

async function createMoodleUser(user) {
    console.log(user);
    const params = new URLSearchParams();
    params.append('moodlewsrestformat', 'json');
    params.append('wsfunction', 'core_user_create_users');
    params.append('wstoken', process.env.MDL_TOKEN);
    params.append('users[0][username]', user.username);
    params.append('users[0][createpassword]', 1);
    params.append('users[0][firstname]', user.firstname);
    params.append('users[0][lastname]', user.lastname);
    params.append('users[0][institution]', user.institution);
    //params.append('users[0][country]', user.country);
    params.append('users[0][phone1]', user.phone);
    params.append('users[0][email]', user.email);
    params.append('users[0][idnumber]', 'AUTOGENERATEDID002');
    params.append('users[0][description]', 'auto-generated');
    params.append('users[0][lang]', 'en');
    var config = {
        method: 'post',
        url: WebServiceUrl,
        headers: {},
        params :  params
      };

    let res = await axios(config)
    return res;
}

async function enrollMoodleuser(userId, courseId){
    const params = new URLSearchParams();
    params.append('moodlewsrestformat', 'json');
    params.append('wsfunction', 'enrol_manual_enrol_users');
    params.append('wstoken', process.env.MDL_TOKEN);
    params.append('enrolments[0][roleid]', '5');
    params.append('enrolments[0][userid]', userId);
    params.append('enrolments[0][courseid]', courseId);
    params.append('enrolments[0][timestart]', '1672178173');
    params.append('enrolments[0][timeend]', '1678921849');
    params.append('enrolments[0][suspend]', '0'); //Este valor se puede usar para automatizar la extensión de matrícula

    var config = {
        method: 'post',
        url: WebServiceUrl,
        headers: {},
        params :  params
      };

    let res = await axios(config)
    return res;
}

async function addUserToMoodleGroup(userId, groupid){
    const params = new URLSearchParams();
    params.append('moodlewsrestformat', 'json');
    params.append('wsfunction', 'core_group_add_group_members');
    params.append('wstoken', process.env.MDL_TOKEN);
    params.append('members[0][groupid]', groupid); //id del grupo al cual se espera incluir al usuario
    params.append('members[0][userid]', userId);

    var config = {
        method: 'post',
        url: WebServiceUrl,
        headers: {},
        params :  params
      };

    let res = await axios(config)
    return res;
}
